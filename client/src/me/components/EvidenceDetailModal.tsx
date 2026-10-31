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
import { cameraOutline, close, downloadOutline, saveOutline } from 'ionicons/icons';
import { imageSrc, updateEvidence, type Evidence, type Kind } from '../lib/evidence';
import { KIND_LABEL, dateTimeLabel, shiftDayLabel } from '../lib/dates';
import { isIOS, photoFileName, saveToDevice } from '../lib/device';
import { errorMessage } from '../api';
import { DayPicker } from './DayPicker';

interface Props {
  evidence: Evidence | null;
  maxDate: string;
  employeeCode?: string;
  onClose: () => void;
  onReplacePhoto: (evidence: Evidence) => void;
  onSaved: (evidence: Evidence) => void;
}

// One photo, big — with when it was taken and sent, and everything that can
// be changed about it: the photo itself, its shift-day, in/out, the note.
export const EvidenceDetailModal: React.FC<Props> = ({ evidence, maxDate, employeeCode, onClose, onReplacePhoto, onSaved }) => {
  const [date, setDate] = useState('');
  const [kind, setKind] = useState<Kind>('in');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!evidence) return;
    setDate(evidence.date);
    setKind(evidence.kind);
    setNote(evidence.note ?? '');
    setError(null);
  }, [evidence]);

  const changed = !!evidence && (date !== evidence.date || kind !== evidence.kind || note !== (evidence.note ?? ''));

  const save = async () => {
    if (!evidence) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateEvidence(evidence._id, { date, kind, note }));
    } catch (err) {
      setError(errorMessage(err, 'ບັນທຶກບໍ່ສຳເລັດ'));
    } finally {
      setSaving(false);
    }
  };

  const download = async () => {
    if (!evidence) return;
    const blob = await fetch(imageSrc(evidence.photoUrl)).then((r) => r.blob());
    await saveToDevice(blob, photoFileName(employeeCode, evidence.date, evidence.kind));
  };

  return (
    <IonModal isOpen={!!evidence} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose} aria-label="ປິດ">
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
          <IonTitle>{evidence ? `${KIND_LABEL[evidence.kind]} · ${shiftDayLabel(evidence.date)}` : ''}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {evidence && (
          <div className="mx-auto flex max-w-xl flex-col gap-4 p-4 pb-safe">
            <div className="overflow-hidden rounded-3xl bg-black shadow-lg">
              <img src={imageSrc(evidence.photoUrl)} alt={KIND_LABEL[evidence.kind]} className="mx-auto max-h-[50vh] w-full object-contain" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <IonButton fill="outline" shape="round" onClick={() => onReplacePhoto(evidence)}>
                <IonIcon slot="start" icon={cameraOutline} /> ປ່ຽນຮູບ
              </IonButton>
              <IonButton fill="outline" shape="round" onClick={() => void download()}>
                <IonIcon slot="start" icon={downloadOutline} /> {isIOS() ? 'ລົງຄັງຮູບ' : 'ບັນທຶກລົງເຄື່ອງ'}
              </IonButton>
            </div>

            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-2xl bg-white p-4 text-sm ring-1 ring-stone-100">
              <dt className="text-stone-500">ຖ່າຍເມື່ອ</dt>
              <dd className="m-0 font-medium">{dateTimeLabel(evidence.takenAt)}</dd>
              <dt className="text-stone-500">ສົ່ງເມື່ອ</dt>
              <dd className="m-0 font-medium">
                {dateTimeLabel(evidence.uploadedAt)}
                {evidence.backdated && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">ຍ້ອນຫຼັງ</span>}
              </dd>
              {evidence.editedAt && (
                <>
                  <dt className="text-stone-500">ແກ້ໄຂເມື່ອ</dt>
                  <dd className="m-0 font-medium">{dateTimeLabel(evidence.editedAt)}</dd>
                </>
              )}
            </dl>

            <div className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-stone-100">
              <div className="text-sm font-semibold">ແກ້ໄຂ</div>
              <IonSegment value={kind} onIonChange={(e) => setKind(e.detail.value as Kind)}>
                <IonSegmentButton value="in">
                  <IonLabel>{KIND_LABEL.in}</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="out">
                  <IonLabel>{KIND_LABEL.out}</IonLabel>
                </IonSegmentButton>
              </IonSegment>
              {date && <DayPicker value={date} max={maxDate} onChange={setDate} />}
              <div className="rounded-2xl border border-stone-200 px-4 py-1">
                <IonTextarea label="ໝາຍເຫດ" labelPlacement="stacked" autoGrow maxlength={500} value={note} onIonInput={(e) => setNote(String(e.detail.value ?? ''))} />
              </div>
              {error && <div className="rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
              <IonButton expand="block" shape="round" disabled={!changed || saving} onClick={() => void save()}>
                {saving ? <IonSpinner name="crescent" /> : <><IonIcon slot="start" icon={saveOutline} /> ບັນທຶກການແກ້ໄຂ</>}
              </IonButton>
            </div>

            {evidence.history.length > 0 && (
              <div className="rounded-2xl bg-white p-4 ring-1 ring-stone-100">
                <div className="mb-2 text-sm font-semibold">ຮູບກ່ອນໜ້າ ({evidence.history.length})</div>
                <div className="flex gap-2 overflow-x-auto">
                  {evidence.history.map((h, i) => (
                    <a key={i} href={imageSrc(h.photoUrl)} target="_blank" rel="noreferrer" className="shrink-0 text-center text-xs text-stone-500">
                      <img src={imageSrc(h.thumbUrl)} alt="" className="h-20 w-24 rounded-xl object-cover" />
                      <div className="mt-1">ແທນເມື່ອ {dateTimeLabel(h.replacedAt)}</div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </IonContent>
    </IonModal>
  );
};
