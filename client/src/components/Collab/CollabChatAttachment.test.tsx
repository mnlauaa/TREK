import { fireEvent, render, screen } from '../../../tests/helpers/render'
import userEvent from '@testing-library/user-event'
import { CollabChatAttachment } from './CollabChatAttachment'

it('opens attachments by keyboard, keeps image clicks open and closes with Escape', async () => {
  const original = HTMLDialogElement.prototype.showModal
  const show = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: show })
  try {
    render(<CollabChatAttachment attachment={{ url: '/photo.jpg', original_name: 'Photo' }} />)
    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Photo' })).toHaveFocus()
    await user.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: 'Photo' })
    expect(show).toHaveBeenCalledOnce()
    fireEvent.click(dialog.querySelector('img')!)
    expect(dialog).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  } finally {
    if (original) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: original })
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  }
})
