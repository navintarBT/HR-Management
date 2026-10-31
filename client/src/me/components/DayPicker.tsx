import { useState } from 'react';
import { IonButton, IonButtons, IonDatetime, IonIcon, IonModal, IonTitle, IonToolbar, IonHeader, IonContent } from '@ionic/react';
import { calendarOutline } from 'ionicons/icons';
import { shiftDayLabel } from '../lib/dates';

// Which shift-day a photo belongs to — shown in Lao, changed on a calendar
// (nothing after `max`, the current shift-day).
export const DayPicker: React.FC<{ value: string; max: string; onChange: (date: string) => void }> = ({ value, max, onChange }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
        className="flex w-full items-center justify-between rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left active:bg-stone-50"
      >
        <div>
          <div className="text-xs text-stone-500">ກະວັນທີ</div>
          <div className="font-semibold">{shiftDayLabel(value)}</div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-wine-50 px-3 py-1.5 text-sm font-medium text-wine-700">
          <IonIcon icon={calendarOutline} /> ປ່ຽນວັນ
        </span>
      </button>
      <IonModal isOpen={open} onDidDismiss={() => setOpen(false)} initialBreakpoint={0.75} breakpoints={[0, 0.75, 1]}>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={() => setOpen(false)}>ຍົກເລີກ</IonButton>
            </IonButtons>
            <IonTitle>ເລືອກວັນກະ</IonTitle>
            <IonButtons slot="end">
              <IonButton
                strong
                onClick={() => {
                  onChange(draft);
                  setOpen(false);
                }}
              >
                ຕົກລົງ
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <div className="flex justify-center p-2">
            <IonDatetime
              presentation="date"
              locale="lo-LA"
              firstDayOfWeek={1}
              max={max}
              value={draft}
              onIonChange={(e) => {
                const v = e.detail.value;
                if (typeof v === 'string') setDraft(v.slice(0, 10));
              }}
            />
          </div>
          <div className="pb-4 text-center text-sm text-stone-500">{shiftDayLabel(draft)}</div>
        </IonContent>
      </IonModal>
    </>
  );
};
