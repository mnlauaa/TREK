/**
 * Real MCP protocol, permission and persistence coverage for visit/day timing writes.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: () => null,
    canAccessTrip: (tripId: any, userId: number) =>
      db.prepare(`SELECT t.id, t.user_id FROM trips t LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ? WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)`).get(userId, tripId, userId),
    isOwner: (tripId: any, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trek-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

const { broadcastMock } = vi.hoisted(() => ({ broadcastMock: vi.fn() }));
vi.mock('../../../src/websocket', () => ({ broadcast: broadcastMock }));

import { invalidatePermissionsCache } from '../../../src/nest/permissions/permissions-cache';
import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser, createTrip, createDay, createPlace, createDayAssignment, addTripMember } from '../../helpers/factories';
import { createMcpHarness, parseToolResult, type McpHarness } from '../../helpers/mcp-harness';

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  broadcastMock.mockClear();
  invalidatePermissionsCache();
  delete process.env.DEMO_MODE;
});

afterAll(() => {
  delete process.env.DEMO_MODE;
  invalidatePermissionsCache();
  testDb.close();
});

async function withHarness(userId: number, fn: (h: McpHarness) => Promise<void>) {
  const h = await createMcpHarness({ userId, withResources: false });
  try { await fn(h); } finally { await h.cleanup(); }
}

const timing = { enabled: true, start: '10:30', travel: [{ from: 'assignment:1', to: 'assignment:2', mode: 'walking', minutes: 25 }] };

function fixture(email?: string) {
  const { user } = createUser(testDb, email ? { email } : {});
  const trip = createTrip(testDb, user.id);
  const day = createDay(testDb, trip.id);
  const place = createPlace(testDb, trip.id);
  const assignment = createDayAssignment(testDb, day.id, place.id);
  return { user, trip, day, assignment };
}

function stored() {
  return {
    days: testDb.prepare('SELECT id, timing_json FROM days ORDER BY id').all(),
    visits: testDb.prepare('SELECT id, stay_minutes FROM day_assignments ORDER BY id').all(),
  };
}

for (const kind of ['day', 'stay'] as const) {
  const name = kind === 'day' ? 'set_day_timing' : 'set_assignment_stay';
  const args = (f: ReturnType<typeof fixture>): Record<string, unknown> => kind === 'day'
    ? { tripId: f.trip.id, dayId: f.day.id, ...timing }
    : { tripId: f.trip.id, assignmentId: f.assignment.id, stay_minutes: 90 };

  describe(`Tool: ${name}`, () => {
    it('persists an authorized write and broadcasts the saved entity', async () => {
      const f = fixture();
      await withHarness(f.user.id, async h => {
        const result = await h.client.callTool({ name, arguments: args(f) });
        expect(result.isError).not.toBe(true);
        const saved = kind === 'day'
          ? { day: { id: f.day.id, timing } }
          : { assignment: { id: f.assignment.id, stay_minutes: 90 } };
        const data = parseToolResult(result) as Record<string, unknown>;
        expect(data).toMatchObject(saved);
        expect(broadcastMock).toHaveBeenCalledExactlyOnceWith(f.trip.id,
          kind === 'day' ? 'day:updated' : 'assignment:updated', { ...data, _source: 'mcp' });
      });
      if (kind === 'day') {
        const row = testDb.prepare('SELECT timing_json FROM days WHERE id = ?').get(f.day.id) as { timing_json: string };
        expect(JSON.parse(row.timing_json)).toEqual(timing);
      } else {
        expect(testDb.prepare('SELECT stay_minutes FROM day_assignments WHERE id = ?').get(f.assignment.id)).toEqual({ stay_minutes: 90 });
      }
    });

    it('rejects demo writes without mutation or broadcast', async () => {
      process.env.DEMO_MODE = 'true';
      const f = fixture('demo@nomad.app');
      const before = stored();
      await withHarness(f.user.id, async h => {
        const result = await h.client.callTool({ name, arguments: args(f) });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toMatch(/demo/i);
      });
      expect(stored()).toEqual(before);
      expect(broadcastMock).not.toHaveBeenCalled();
    });

    it('rejects a non-member even with a valid target id', async () => {
      const f = fixture();
      const { user: outsider } = createUser(testDb);
      const before = stored();
      await withHarness(outsider.id, async h => {
        const result = await h.client.callTool({ name, arguments: args(f) });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain('access denied');
      });
      expect(stored()).toEqual(before);
      expect(broadcastMock).not.toHaveBeenCalled();
    });

    it('enforces day_edit independently of trip membership', async () => {
      const f = fixture();
      const { user: member } = createUser(testDb);
      addTripMember(testDb, f.trip.id, member.id);
      testDb.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('perm_day_edit', 'trip_owner')").run();
      invalidatePermissionsCache();
      const before = stored();
      await withHarness(member.id, async h => {
        const result = await h.client.callTool({ name, arguments: args(f) });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain('do not have permission');
      });
      expect(stored()).toEqual(before);
      expect(broadcastMock).not.toHaveBeenCalled();
    });

    it.each(['foreign', 'missing'] as const)('rejects a %s entity without mutation or broadcast', async target => {
      const f = fixture();
      const otherTrip = createTrip(testDb, f.user.id);
      const arguments_ = args(f);
      if (target === 'foreign') arguments_.tripId = otherTrip.id;
      else arguments_[kind === 'day' ? 'dayId' : 'assignmentId'] = 999999;
      const before = stored();
      await withHarness(f.user.id, async h => {
        const result = await h.client.callTool({ name, arguments: arguments_ });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain(kind === 'day' ? 'Day not found' : 'Assignment not found');
      });
      expect(stored()).toEqual(before);
      expect(broadcastMock).not.toHaveBeenCalled();
    });

    const invalid: Record<string, unknown>[] = kind === 'day'
      ? [{ start: '24:00' }, { start: '09:60' }, { enabled: 'true' }, { travel: [{ from: 'a', to: 'b', mode: 'walking', minutes: -1 }] }]
      : [{ stay_minutes: -1 }, { stay_minutes: 1441 }, { stay_minutes: 1.5 }, { stay_minutes: '90' }];
    it.each(invalid)('validates MCP input %j before writing', async invalidFields => {
      const f = fixture();
      const before = stored();
      await withHarness(f.user.id, async h => {
        const result = await h.client.callTool({ name, arguments: { ...args(f), ...invalidFields } });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain('Invalid arguments');
      });
      expect(stored()).toEqual(before);
      expect(broadcastMock).not.toHaveBeenCalled();
    });
  });
}

it('accepts zero stay and null restores the place default without changing the place', async () => {
  const f = fixture();
  const original = testDb.prepare('SELECT duration_minutes FROM places WHERE id = (SELECT place_id FROM day_assignments WHERE id = ?)').get(f.assignment.id);
  await withHarness(f.user.id, async h => {
    for (const stay_minutes of [0, null]) {
      const result = await h.client.callTool({ name: 'set_assignment_stay', arguments: { tripId: f.trip.id, assignmentId: f.assignment.id, stay_minutes } });
      expect(result.isError).not.toBe(true);
      expect(parseToolResult(result)).toMatchObject({ assignment: { stay_minutes } });
      expect(testDb.prepare('SELECT stay_minutes FROM day_assignments WHERE id = ?').get(f.assignment.id)).toEqual({ stay_minutes });
    }
  });
  expect(testDb.prepare('SELECT duration_minutes FROM places WHERE id = (SELECT place_id FROM day_assignments WHERE id = ?)').get(f.assignment.id)).toEqual(original);
});
