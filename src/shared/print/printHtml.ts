/** The system print dialog, where "Save as PDF" is one of the printers. */
export function printHtml(html: string) {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
  frame.srcdoc = html
  frame.onload = () => {
    const win = frame.contentWindow
    if (!win) return
    // The print dialog may not block; remove the frame only once printing is done.
    win.addEventListener('afterprint', () => setTimeout(() => frame.remove()))
    win.focus()
    win.print()
  }
  document.body.appendChild(frame)
}
