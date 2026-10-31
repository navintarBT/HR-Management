import { useEffect, useState } from 'react';
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
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { alertCircle, close, cloudUploadOutline, downloadOutline, refreshOutline, timeOutline } from 'ionicons/icons';
import type { PreparedPhoto } from '../lib/image';
import { sendPhoto, type Kind, type SendResult } from '../lib/evidence';
import { isIOS, photoFileName, saveToDevice } from '../lib/device';
import { KIND_LABEL, timeLabel } from '../lib/dates';
import { DayPicker } from './DayPicker';

interface Props {
  photo: PreparedPhoto | null;
  // Which shift-day and in/out it goes to, worked out by the screen that took
  // it; changeable here.
  date: string;
  kind: Kind;
  // The current shift-day — nothing later can be picked.
  maxDate: string;
  // Replacing a photo that's already been sent.
  editId?: string;
  employeeCode?: string;
  // Whether that shift already has a photo of that kind (sending replaces it).
  slotTaken: (date: string, kind: Kind) => boolean;
  onRetake: () => void;
  onClose: () => void;
  onDone: (result: SendResult) => void;
}

// One look at the photo before it goes: which shift and in/out it's for
// (filled in already), an optional note, one big button to send.
export const ReviewModal: React.FC<Props> = ({ photo, date: initialDate, kind: initialKind, maxDate, editId, employeeCode, slotTaken, onRetake, onClose, onDone }) => {
  const [date, setDate] = useState(initialDate);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) return;
    setDate(initialDate);
    setKind(initialKind);
    setNote('');
    setNoteOpen(false);
    setError(null);
  }, [photo, initialDate, initialKind]);

  const send = async () => {
    if (!photo) return;
    setSending(true);
    setError(null);
    const result = await sendPhoto(photo, { date, kind, note: note.trim() || undefined, editId });
    setSending(false);
    if (result.status === 'error' || result.status === 'needsKind') setError(result.message);
    else onDone(result);
  };

  const backdated = date < maxDate;
  const replaces = !editId && slotTaken(date, kind);

  return (
    <IonModal isOpen={!!photo} onDidDismiss={onClose} className="me-review">
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose} aria-label="ປິດ">
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
          <IonTitle>{editId ? 'ປ່ຽນຮູບ' : 'ກວດຮູບກ່ອນສົ່ງ'}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {photo && (
          <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
            <div className="overflow-hidden rounded-3xl bg-black shadow-lg">
              <img src={photo.previewUrl} alt="ຮູບທີ່ຖ່າຍ" className="mx-auto max-h-[46vh] w-full object-contain" />
            </div>
            <div className="flex items-center justify-between text-sm text-stone-500">
              <span className="inline-flex items-center gap-1">
                <IonIcon icon={timeOutline} /> ຖ່າຍເວລາ {timeLabel(photo.takenAt)}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 font-medium text-wine-600 active:bg-wine-50"
                onClick={() => void saveToDevice(photo.photo, photoFileName(employeeCode, date, kind))}
              >
                <IonIcon icon={downloadOutline} /> {isIOS() ? 'ບັນທຶກລົງຄັງຮູບ' : 'ບັນທຶກລົງເຄື່ອງ'}
              </button>
            </div>

            <IonSegment value={kind} onIonChange={(e) => setKind(e.detail.value as Kind)}>
              <IonSegmentButton value="in">
                <IonLabel>{KIND_LABEL.in}</IonLabel>
              </IonSegmentButton>
              <IonSegmentButton value="out">
                <IonLabel>{KIND_LABEL.out}</IonLabel>
              </IonSegmentButton>
            </IonSegment>

            <DayPicker value={date} max={maxDate} onChange={setDate} />

            {(backdated || replaces) && (
              <div className="space-y-1 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {backdated && <div>• ອັບໂຫຼດຍ້ອນຫຼັງ — HR ຈະເຫັນວ່າສົ່ງຫຼັງວັນນັ້ນ</div>}
                {replaces && <div>• ກະນີ້ມີຮູບ{KIND_LABEL[kind]}ແລ້ວ — ຮູບນີ້ຈະແທນ (ຮູບເກົ່າຍັງເກັບໄວ້)</div>}
              </div>
            )}

            {noteOpen ? (
              <div className="rounded-2xl border border-stone-200 bg-white px-4 py-1">
                <IonTextarea label="ໝາຍເຫດ" labelPlacement="stacked" autoGrow maxlength={500} value={note} onIonInput={(e) => setNote(String(e.detail.value ?? ''))} />
              </div>
            ) : (
              <button type="button" className="self-start text-sm font-medium text-wine-600" onClick={() => setNoteOpen(true)}>
                + ເພີ່ມໝາຍເຫດ
              </button>
            )}

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                <IonIcon icon={alertCircle} className="mt-0.5 shrink-0 text-lg" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-[auto_1fr] gap-3 pb-safe">
              <IonButton fill="outline" shape="round" className="h-12" onClick={onRetake} disabled={sending}>
                <IonIcon slot="start" icon={refreshOutline} /> ຖ່າຍໃໝ່
              </IonButton>
              <IonButton shape="round" className="h-12 text-base font-semibold" onClick={() => void send()} disabled={sending}>
                {sending ? <IonSpinner name="crescent" /> : <><IonIcon slot="start" icon={cloudUploadOutline} /> ສົ່ງຮູບ{KIND_LABEL[kind]}</>}
              </IonButton>
            </div>
          </div>
        )}
      </IonContent>
    </IonModal>
  );
};
