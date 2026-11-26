import { useEffect, useRef, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonLabel,
  IonModal,
  IonSegment,
  IonSegmentButton,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { close, cloudOffline, cloudUploadOutline, downloadOutline, refreshOutline, timeOutline } from 'ionicons/icons';
import type { Kind } from '../lib/evidence';
import type { Connection } from '../lib/connection';
import { isIOS, photoFileName, saveToDevice } from '../lib/device';
import { KIND_LABEL, timeLabel } from '../lib/dates';
import { DayPicker } from './DayPicker';

// A photo just taken or picked (already kept on the phone: lib/queue.ts).
export interface ReviewPhoto {
  id: string;
  photo: Blob;
  previewUrl: string;
  takenAt: string;
  // Which shift-day and in/out it goes to, worked out by the screen that took
  // it; changeable here.
  date: string;
  kind: Kind;
  note?: string;
  // Replacing a photo that's already been sent.
  editId?: string;
  // Goes by itself unless stopped: a photo of the shift in progress.
  autoSend: boolean;
  // Nothing is known about the shift (first time opened without internet):
  // unless the person chooses, the server places it by its time.
  unplaced?: boolean;
}

export interface SendFields {
  date?: string;
  kind?: Kind;
  note?: string;
}

interface Props {
  review: ReviewPhoto | null;
  connection: Connection;
  // The current shift-day — nothing later can be picked.
  maxDate: string;
  employeeCode?: string;
  // Whether that shift already has a photo of that kind (sending replaces it).
  slotTaken: (date: string, kind: Kind) => boolean;
  onSend: (review: ReviewPhoto, fields: SendFields) => void;
  // Thrown away, to take another.
  onRetake: (review: ReviewPhoto) => void;
  // The ✕: asks what to do with it.
  onClose: (review: ReviewPhoto, fields: SendFields) => void;
}

const AUTO_SEND_SECONDS = 10;

// One look at the photo before it goes: which shift and in/out it's for
// (filled in already), an optional note, one big button to send. A photo of
// the shift in progress goes by itself after a few seconds — and at once if the
// person leaves the app — so a forgotten button doesn't lose it.
export const ReviewModal: React.FC<Props> = ({ review, ...rest }) => (
  <IonModal isOpen={!!review} backdropDismiss={false} className="me-review">
    {/* A fresh sheet for every photo: nothing carries over from the one before. */}
    {review && <ReviewSheet key={review.id} review={review} {...rest} />}
  </IonModal>
);

const ReviewSheet: React.FC<Props & { review: ReviewPhoto }> = ({ review, connection, maxDate, employeeCode, slotTaken, onSend, onRetake, onClose }) => {
  const [date, setDate] = useState(review.date);
  const [kind, setKind] = useState<Kind>(review.kind);
  const [note, setNote] = useState(review.note ?? '');
  const [noteOpen, setNoteOpen] = useState(!!review.note);
  const [chosen, setChosen] = useState(false);
  const [left, setLeft] = useState<number | null>(review.autoSend ? AUTO_SEND_SECONDS : null);

  const fields = (): SendFields => ({
    ...(review.unplaced && !chosen ? {} : { date, kind }),
    note: note.trim() || undefined,
  });
  // Once only: the button, the countdown and leaving the app can come together.
  const sent = useRef(false);
  const send = () => {
    if (sent.current) return;
    sent.current = true;
    onSend(review, fields());
  };
  const latest = useRef(send);
  latest.current = send;

  // Counts down to sending by itself.
  useEffect(() => {
    if (left === null) return undefined;
    if (left <= 0) {
      latest.current();
      return undefined;
    }
    const timer = setTimeout(() => setLeft((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  // Leaving the app (locking the phone, switching away) sends it there and then.
  useEffect(() => {
    if (!review.autoSend) return undefined;
    const onHidden = () => {
      if (document.hidden) latest.current();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [review.autoSend]);

  const change = (apply: () => void) => {
    setLeft(null);
    setChosen(true);
    apply();
  };

  const backdated = date < maxDate;
  const replaces = !review.editId && slotTaken(date, kind);

  return (
    <>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton
              onClick={() => {
                setLeft(null);
                onClose(review, fields());
              }}
              aria-label="ປິດ"
            >
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
          <IonTitle>{review.editId ? 'ປ່ຽນຮູບ' : 'ກວດຮູບກ່ອນສົ່ງ'}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
          <div className="overflow-hidden rounded-3xl bg-black shadow-lg">
            <img src={review.previewUrl} alt="ຮູບທີ່ຖ່າຍ" className="mx-auto max-h-[46vh] w-full object-contain" />
          </div>
          <div className="flex items-center justify-between text-sm text-stone-500">
            <span className="inline-flex items-center gap-1">
              <IonIcon icon={timeOutline} /> ຖ່າຍເວລາ {timeLabel(review.takenAt)}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 font-medium text-wine-600 active:bg-wine-50"
              onClick={() => {
                setLeft(null);
                void saveToDevice(review.photo, photoFileName(employeeCode, date, kind));
              }}
            >
              <IonIcon icon={downloadOutline} /> {isIOS() ? 'ບັນທຶກລົງຄັງຮູບ' : 'ບັນທຶກລົງເຄື່ອງ'}
            </button>
          </div>

          <IonSegment value={kind} onIonChange={(e) => change(() => setKind(e.detail.value as Kind))}>
            <IonSegmentButton value="in">
              <IonLabel>{KIND_LABEL.in}</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="out">
              <IonLabel>{KIND_LABEL.out}</IonLabel>
            </IonSegmentButton>
          </IonSegment>

          <DayPicker value={date || maxDate} max={maxDate} onChange={(d) => change(() => setDate(d))} />

          {connection !== 'online' && (
            <div className="flex items-start gap-2 rounded-2xl bg-stone-800 px-4 py-3 text-sm text-white">
              <IonIcon icon={cloudOffline} className="mt-0.5 shrink-0 text-lg text-amber-300" />
              <span>ຕອນນີ້ອອຟລາຍ — ກົດສົ່ງໄດ້ເລີຍ, ຮູບເກັບໄວ້ໃນເຄື່ອງ ແລະ ຈະສົ່ງເອງເມື່ອມີເນັດ</span>
            </div>
          )}

          {(backdated || replaces || (review.unplaced && !chosen)) && (
            <div className="space-y-1 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {review.unplaced && !chosen && <div>• ຍັງບໍ່ຮູ້ກະຂອງທ່ານ (ບໍ່ມີເນັດ) — ຖ້າບໍ່ເລືອກ ລະບົບຈະຈັດເຂົ້າກະຕາມເວລາຖ່າຍ</div>}
              {backdated && <div>• ອັບໂຫຼດຍ້ອນຫຼັງ — HR ຈະເຫັນວ່າສົ່ງຫຼັງວັນນັ້ນ</div>}
              {replaces && <div>• ກະນີ້ມີຮູບ{KIND_LABEL[kind]}ແລ້ວ — ຮູບນີ້ຈະແທນ (ຮູບເກົ່າຍັງເກັບໄວ້)</div>}
            </div>
          )}

          {noteOpen ? (
            <div className="rounded-2xl border border-stone-200 bg-white px-4 py-1">
              <IonTextarea label="ໝາຍເຫດ" labelPlacement="stacked" autoGrow maxlength={500} value={note} onIonInput={(e) => setNote(String(e.detail.value ?? ''))} />
            </div>
          ) : (
            <button
              type="button"
              className="self-start text-sm font-medium text-wine-600"
              onClick={() => {
                setLeft(null);
                setNoteOpen(true);
              }}
            >
              + ເພີ່ມໝາຍເຫດ
            </button>
          )}

          {left !== null && (
            <div className="flex items-center justify-between rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800" data-auto-send>
              <span>
                ຈະສົ່ງເອງໃນ <b>{left}</b> ວິນາທີ
              </span>
              <button type="button" className="font-semibold text-emerald-900 underline" onClick={() => setLeft(null)}>
                ຢຸດ
              </button>
            </div>
          )}

          <div className="grid grid-cols-[auto_1fr] gap-3 pb-safe">
            <IonButton fill="outline" shape="round" className="h-12" onClick={() => onRetake(review)}>
              <IonIcon slot="start" icon={refreshOutline} /> ຖ່າຍໃໝ່
            </IonButton>
            <IonButton shape="round" className="h-12 text-base font-semibold" onClick={send}>
              <IonIcon slot="start" icon={cloudUploadOutline} /> {review.unplaced && !chosen ? 'ສົ່ງຮູບ' : `ສົ່ງຮູບ${KIND_LABEL[kind]}`}
            </IonButton>
          </div>
        </div>
      </IonContent>
    </>
  );
};
