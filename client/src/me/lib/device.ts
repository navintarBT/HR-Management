// Keeping a copy of each photo on the phone. A web app can't drop a file into
// the photo gallery by itself: Android (and computers) get it as a download;
// an iPhone has to be offered the share sheet, where "Save Image" puts it in
// Photos — that needs a tap of its own.
export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function saveToDevice(blob: Blob, name: string) {
  const file = new File([blob], name, { type: 'image/jpeg' });
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch {
      // closed the share sheet
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const photoFileName = (employeeCode: string | undefined, date: string, kind: 'in' | 'out') =>
  `ROMEO_${employeeCode ?? 'me'}_${date}_${kind === 'in' ? 'ເຂົ້າ' : 'ອອກ'}.jpg`;

// "Keep a copy on this phone" — on unless turned off in the menu.
const AUTO_SAVE_KEY = 'me_auto_save';
export function autoSaveEnabled() {
  try {
    return localStorage.getItem(AUTO_SAVE_KEY) !== 'off';
  } catch {
    return true;
  }
}
export function setAutoSave(on: boolean) {
  try {
    localStorage.setItem(AUTO_SAVE_KEY, on ? 'on' : 'off');
  } catch {
    // private mode: stays on for this visit
  }
}
