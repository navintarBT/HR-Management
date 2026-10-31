import { useRef } from 'react';
import { preparePickedFile, type PreparedPhoto } from '../lib/image';

// The phone's own camera app and its gallery, through plain file inputs —
// works everywhere, including where the live camera in the page can't
// (no permission, an old browser, a page not on https).
export function usePhotoPicker(onPicked: (photo: PreparedPhoto) => void, onError: (message: string) => void) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  const handle = async (input: HTMLInputElement | null) => {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    try {
      onPicked(await preparePickedFile(file));
    } catch {
      onError('ເປີດຮູບນີ້ບໍ່ໄດ້ — ລອງຮູບອື່ນ');
    }
  };

  const inputs = (
    <>
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handle(e.currentTarget)} />
      <input ref={galleryInput} type="file" accept="image/*" className="hidden" onChange={(e) => void handle(e.currentTarget)} />
    </>
  );

  return {
    inputs,
    openCameraApp: () => cameraInput.current?.click(),
    openGallery: () => galleryInput.current?.click(),
  };
}
