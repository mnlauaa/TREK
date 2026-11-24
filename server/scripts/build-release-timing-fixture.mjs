import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(server);
const release = 'f416f27e30f313959b36af1abbb9a6d15ea24e6a';
const Database = createRequire(import.meta.url)('better-sqlite3');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trek-release-timing-'));
try {
  execFileSync('git', ['archive', '-o', path.join(tmp, 'source.tar'), release, 'server/src', 'server/package.json', 'server/tsconfig.json'], { cwd: repo });
  execFileSync('tar', ['-xf', 'source.tar'], { cwd: tmp });
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(tmp, 'node_modules'));
  fs.symlinkSync(path.join(server, 'node_modules'), path.join(tmp, 'server/node_modules'));
  const file = path.join(tmp, 'release.db');
  fs.writeFileSync(path.join(tmp, 'server/boot.cjs'), "require('./src/db/database.ts').closeDb();\n");
  execFileSync(process.execPath, ['--import', 'tsx', 'boot.cjs'], {
    cwd: path.join(tmp, 'server'),
    env: { PATH: process.env.PATH, NODE_ENV: 'production', TREK_DB_FILE: file, ENCRYPTION_KEY: '0'.repeat(64), ADMIN_EMAIL: 'fixture@example.invalid', ADMIN_PASSWORD: 'synthetic-unused-password', TREK_SERVICES: 'off' },
    stdio: 'ignore',
  });
  const db = new Database(file);
  db.exec(`
    UPDATE users SET password_hash='synthetic-disabled';
    INSERT INTO trips (id,user_id,title,currency) VALUES (1,1,'Release timing fixture','USD');
    INSERT INTO days (id,trip_id,day_number,date,timing_json) VALUES
      (1,1,1,'2027-01-01','{"enabled":true,"start":"08:30","travel":[{"from":"assignment:1","to":"reservation:1:departure","mode":"walking","minutes":12}]}'),
      (2,1,2,'2027-01-02','{"enabled":false,"start":"10:00","travel":[]}');
    INSERT INTO places (id,trip_id,name,place_time,end_time,duration_minutes) VALUES (1,1,'Repeated visit','09:00','10:00',60);
    INSERT INTO day_assignments (id,day_id,place_id,order_index,stay_minutes,times_explicit,assignment_time,assignment_end_time) VALUES
      (1,1,1,0,0,1,NULL,NULL), (2,2,1,0,NULL,0,NULL,NULL);
    INSERT INTO reservations (id,trip_id,day_id,place_id,title,type,reservation_time,reservation_end_time) VALUES
      (1,1,1,1,'Independent booking','event','2027-01-01T11:00','2027-01-01T12:30');
    UPDATE fork_schema_migrations SET applied_at='2026-10-06 10:00:00';
  `);
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    for (const { name: column } of db.prepare('SELECT name FROM pragma_table_info(?)').all(name)) {
      if (['created_at', 'updated_at', 'added_at', 'last_login'].includes(column)) db.prepare(`UPDATE "${name}" SET "${column}" = ? WHERE "${column}" IS NOT NULL`).run('2026-10-06 10:00:00');
    }
  }
  db.prepare('UPDATE migrations SET timestamp = 0').run();
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  const dump = execFileSync('sqlite3', [file, '.dump'], { encoding: 'utf8' });
  fs.writeFileSync(path.join(server, 'tests/fixtures/legacy/fork-v244-itinerary.sql'), `-- Built by scripts/build-release-timing-fixture.mjs from release ${release}.\n-- Synthetic populated data; no usable credentials.\n${dump}`);
} finally {
  for (const link of [path.join(tmp, 'node_modules'), path.join(tmp, 'server/node_modules')]) if (fs.existsSync(link)) fs.unlinkSync(link);
  fs.rmSync(tmp, { recursive: true, force: true });
}
