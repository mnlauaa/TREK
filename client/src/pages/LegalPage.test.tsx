import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../tests/helpers/render';
import LegalPage from './LegalPage';
import { useLegalPage } from './legal/useLegalPage';

vi.mock('./legal/useLegalPage', () => ({ useLegalPage: vi.fn() }));

describe('LegalPage', () => {
  beforeEach(() => {
    vi.mocked(useLegalPage).mockReturnValue({
      config: {
        version: '4.1.1',
        sourceCodeUrl: 'https://github.com/mnlauaa/TREK/tree/fork-v4.1.1-r1',
        defaultLanguage: 'en',
      },
    });
  });

  it('shows the AGPL license and immutable deployed-source tag', () => {
    render(<LegalPage />);

    expect(screen.getByRole('link', { name: /Read the license/i })).toHaveAttribute(
      'href',
      'https://www.gnu.org/licenses/agpl-3.0.en.html'
    );
    expect(screen.getByRole('link', { name: /fork-v4\.1\.1-r1/ })).toHaveAttribute(
      'href',
      'https://github.com/mnlauaa/TREK/tree/fork-v4.1.1-r1'
    );
    expect(screen.getByText('v4.1.1')).toBeInTheDocument();
  });
});
