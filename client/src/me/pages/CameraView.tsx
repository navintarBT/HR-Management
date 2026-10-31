import { useCallback, useEffect, useRef, useState } from 'react';
import { IonButton, IonIcon, IonSpinner } from '@ionic/react';
import { cameraOutline, cameraReverseOutline, checkmarkCircle, ellipseOutline, imagesOutline, warningOutline } from 'ionicons/icons';
import { captureFrame, type PreparedPhoto } from '../lib/image';
import type { Kind, Today } from '../lib/evidence';
import { KIND_LABEL, shiftDayLabel, timeLabel } from '../lib/dates';
import { autoSaveEnabled, isIOS, photoFileName, saveToDevice } from '../lib/device';

type CameraState = 'starting' | 'live' | 'unavailable';

interface Props {
  active: boolean;
  today: Today | null;
  employeeCode?: string;
  onCaptured: (photo: PreparedPhoto, kind: Kind) => void;
  openCameraApp: () => void;
  openGallery: () => void;
}

// The next photo this shift needs: in first, then out (once both are in, a
// new one replaces out — changeable on the review sheet).
export const nextKind = (today: Today | null): Kind => (today?.in ? 'out' : 'in');

const Slot: React.FC<{ label: string; time?: string | null; done: boolean; next: boolean }> = ({ label, time, done, next }) => (
  <div
    className={`flex flex-1 items-center gap-2 rounded-2xl px-3 py-2 ${
      done ? 'bg-emerald-50 text-emerald-800' : next ? 'bg-wine-50 text-wine-700 ring-2 ring-wine-200' : 'bg-stone-100 text-stone-500'
    }`}
  >
    <IonIcon icon={done ? checkmarkCircle : ellipseOutline} className="text-xl" />
    <div className="leading-tight">
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-xs">{done ? `ສົ່ງແລ້ວ ${time ?? ''}` : next ? 'ຮູບຕໍ່ໄປ' : 'ຍັງບໍ່ມີ'}</div>
    </div>
  </div>
);

// Opens straight onto the live camera: the shift it's for and what's still
// missing on top, one big button to take the photo.
export const CameraView: React.FC<Props> = ({ active, today, employeeCode, onCaptured, openCameraApp, openGallery }) => {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>('starting');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [hasTwoCameras, setHasTwoCameras] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const start = useCallback(async () => {
    stop();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      return;
    }
    setState('starting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play().catch(() => undefined);
      }
      setState('live');
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setHasTwoCameras(devices.filter((d) => d.kind === 'videoinput').length > 1);
    } catch {
      setState('unavailable');
    }
  }, [facing, stop]);

  // The camera runs only while this screen is on show and the app is in front.
  useEffect(() => {
    if (!active) {
      stop();
      return undefined;
    }
    void start();
    const onVisibility = () => (document.hidden ? stop() : void start());
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [active, start, stop]);

  const kind = nextKind(today);

  const shoot = async () => {
    if (!video.current || state !== 'live' || capturing) return;
    setCapturing(true);
    try {
      const photo = await captureFrame(video.current);
      // A copy on the phone straight away (an iPhone gets a button on the
      // review sheet instead — it can't save without one more tap).
      if (autoSaveEnabled() && !isIOS() && today) void saveToDevice(photo.photo, photoFileName(employeeCode, today.date, kind));
      onCaptured(photo, kind);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="flex h-full flex-col md:items-center md:gap-4 md:overflow-y-auto md:p-6">
      <div className="w-full px-4 pt-3 md:max-w-lg md:px-0 md:pt-0">
        <div className="rounded-3xl bg-white p-3 shadow-sm ring-1 ring-stone-100">
          <div className="mb-2 flex items-baseline justify-between px-1">
            <div className="font-semibold">{today ? `ກະ ${shiftDayLabel(today.date)}` : 'ກຳລັງໂຫຼດ…'}</div>
            <div className="text-sm text-stone-500">{today?.shift ? `${today.shift.start} – ${today.shift.end}` : today ? 'ບໍ່ມີກະປະຈຳ' : ''}</div>
          </div>
          <div className="flex gap-2">
            <Slot label={KIND_LABEL.in} time={timeLabel(today?.in?.takenAt)} done={!!today?.in} next={kind === 'in'} />
            <Slot label={KIND_LABEL.out} time={timeLabel(today?.out?.takenAt)} done={!!today?.out} next={kind === 'out' && !today?.out} />
          </div>
          {today?.storageFull && (
            <div className="mt-2 flex items-center gap-2 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700">
              <IonIcon icon={warningOutline} /> ບ່ອນເກັບຮູບເຕັມ — ກະລຸນາແຈ້ງ HR
            </div>
          )}
        </div>
      </div>

      <div className="relative mt-3 flex-1 overflow-hidden bg-black md:mt-0 md:h-[min(64vh,620px)] md:w-full md:max-w-lg md:flex-none md:shrink-0 md:rounded-3xl md:shadow-xl">
        <video ref={video} playsInline muted className={`h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''}`} />
        {state === 'live' && (
          <>
            <div className="me-frame pointer-events-none absolute inset-0" />
            <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
              <span className="rounded-full bg-black/50 px-4 py-1.5 text-sm text-white backdrop-blur">ໃຫ້ເຫັນ ID ແລະ ເວລາ ໃນຮູບ</span>
            </div>
          </>
        )}
        {state === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
            <IonSpinner name="crescent" color="light" />
            <span className="text-sm">ກຳລັງເປີດກ້ອງ…</span>
          </div>
        )}
        {state === 'unavailable' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
              <IonIcon icon={cameraOutline} className="text-3xl" />
            </div>
            <div>
              <div className="text-lg font-semibold">ໃຊ້ກ້ອງຂອງແອັບບໍ່ໄດ້</div>
              <div className="mt-1 text-sm text-white/70">ອະນຸຍາດການໃຊ້ກ້ອງໃນ browser ຫຼື ກົດປຸ່ມລຸ່ມນີ້ເພື່ອເປີດກ້ອງຂອງໂທລະສັບ</div>
            </div>
            <IonButton shape="round" color="light" onClick={openCameraApp}>
              <IonIcon slot="start" icon={cameraOutline} /> ເປີດກ້ອງຖ່າຍຮູບ
            </IonButton>
            <button type="button" className="text-sm text-white/80 underline" onClick={() => void start()}>
              ລອງເປີດກ້ອງແອັບອີກຄັ້ງ
            </button>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-6 pb-5 pt-12">
          <div className="mx-auto flex max-w-sm items-center justify-between">
            <button
              type="button"
              onClick={openGallery}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-2xl text-white backdrop-blur active:bg-white/30"
              aria-label="ເລືອກຈາກຄັງຮູບ"
            >
              <IonIcon icon={imagesOutline} />
            </button>
            <button type="button" className="me-shutter" onClick={() => void (state === 'live' ? shoot() : openCameraApp())} disabled={capturing} aria-label="ຖ່າຍຮູບ">
              <span />
            </button>
            <button
              type="button"
              onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
              className={`flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-2xl text-white backdrop-blur active:bg-white/30 ${hasTwoCameras ? '' : 'invisible'}`}
              aria-label="ສະຫຼັບກ້ອງ"
            >
              <IonIcon icon={cameraReverseOutline} />
            </button>
          </div>
          <div className="mt-2 text-center text-sm font-medium text-white">ຖ່າຍຮູບ{KIND_LABEL[kind]}</div>
        </div>
      </div>
    </div>
  );
};
