import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonPopover,
  IonSegment,
  IonSegmentButton,
  IonToggle,
  IonToolbar,
  useIonActionSheet,
  useIonToast,
} from '@ionic/react';
import { camera, cameraOutline, ellipsisVertical, imagesOutline, logOutOutline, timeOutline, time } from 'ionicons/icons';
import dayjs from 'dayjs';
import { signOut, type MeUser } from '../api';
import { flushQueue, getToday, listEvidence, type Evidence, type Kind, type SendResult, type Today } from '../lib/evidence';
import { onQueueChanged, queuedPhotos, removeQueued, type QueuedPhoto } from '../lib/queue';
import type { PreparedPhoto } from '../lib/image';
import { autoSaveEnabled, setAutoSave } from '../lib/device';
import { KIND_LABEL } from '../lib/dates';
import { CameraView, nextKind } from './CameraView';
import { HistoryView } from './HistoryView';
import { ReviewModal } from '../components/ReviewModal';
import { EvidenceDetailModal } from '../components/EvidenceDetailModal';
import { usePhotoPicker } from '../components/usePhotoPicker';

type Tab = 'camera' | 'history';

interface Review {
  photo: PreparedPhoto;
  date: string;
  kind: Kind;
  editId?: string;
}

// Where a photo picked from the gallery/camera app goes.
interface Target {
  date?: string;
  kind?: Kind;
  editId?: string;
}

export const Shell: React.FC<{ user: MeUser }> = ({ user }) => {
  const employee = user.employee;
  const name = `${employee?.firstName ?? ''} ${employee?.lastName ?? ''}`.trim();
  const initials = (employee?.firstName ?? '?').slice(0, 1);

  const [tab, setTab] = useState<Tab>('camera');
  const [today, setToday] = useState<Today | null>(null);
  const [evidence, setEvidence] = useState<Evidence[] | null>(null);
  const [queued, setQueued] = useState<QueuedPhoto[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [detail, setDetail] = useState<Evidence | null>(null);
  const [autoSave, setAutoSaveState] = useState(autoSaveEnabled());
  const target = useRef<Target>({});
  const [toast, dismissToast] = useIonToast();
  const [actionSheet] = useIonActionSheet();

  // The newest message replaces one still on screen (photos sent back to back).
  const notify = useCallback(
    async (message: string, color: 'success' | 'warning' | 'danger' = 'success') => {
      await dismissToast().catch(() => undefined);
      await toast({ message, color, duration: 2600, position: 'top' });
    },
    [toast, dismissToast]
  );

  const refreshToday = useCallback(() => getToday().then(setToday).catch(() => undefined), []);
  const refreshHistory = useCallback(() => listEvidence().then(setEvidence).catch(() => undefined), []);
  const refreshQueue = useCallback(() => queuedPhotos().then(setQueued), []);

  // Anything taken offline goes out as soon as the app sees the internet.
  const sendWaiting = useCallback(async () => {
    const sent = await flushQueue();
    if (sent) {
      notify(`ສົ່ງຮູບທີ່ລໍຖ້າແລ້ວ ${sent} ຮູບ`);
      void refreshToday();
      void refreshHistory();
    }
  }, [notify, refreshHistory, refreshToday]);

  useEffect(() => {
    void refreshToday();
    void refreshHistory();
    void refreshQueue();
    void sendWaiting();
    const offQueue = onQueueChanged(() => void refreshQueue());
    const onOnline = () => void sendWaiting();
    const onVisible = () => {
      if (document.hidden) return;
      void refreshToday();
      void sendWaiting();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      offQueue();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshHistory, refreshQueue, refreshToday, sendWaiting]);

  // Opening the history always shows it fresh.
  useEffect(() => {
    if (tab === 'history') void refreshHistory();
  }, [tab, refreshHistory]);

  const currentDay = today?.date ?? dayjs().format('YYYY-MM-DD');

  const slotTaken = (date: string, kind: Kind) => {
    if (today && date === today.date) return !!today[kind];
    return !!evidence?.some((e) => e.date === date && e.kind === kind);
  };

  const picker = usePhotoPicker(
    (photo) => {
      const t = target.current;
      // A picked photo with no shift named: the day it was taken (never later
      // than the current shift).
      const takenDay = dayjs(photo.takenAt).format('YYYY-MM-DD');
      const date = t.date ?? (takenDay < currentDay ? takenDay : currentDay);
      setReview({ photo, date, kind: t.kind ?? (date === currentDay ? nextKind(today) : 'in'), editId: t.editId });
    },
    (message) => void notify(message, 'danger')
  );

  const chooseSource = (t: Target, header: string) => {
    target.current = t;
    void actionSheet({
      header,
      buttons: [
        { text: 'ຖ່າຍຮູບ', icon: cameraOutline, handler: () => picker.openCameraApp() },
        { text: 'ເລືອກຈາກຄັງຮູບ', icon: imagesOutline, handler: () => picker.openGallery() },
        { text: 'ຍົກເລີກ', role: 'cancel' },
      ],
    });
  };

  const done = (result: SendResult) => {
    setReview(null);
    if (result.status === 'sent') {
      notify(`ສົ່ງຮູບ${KIND_LABEL[result.evidence.kind]}ແລ້ວ ✓`);
      if (detail && detail._id === result.evidence._id) setDetail(result.evidence);
    } else if (result.status === 'queued') {
      notify('ບໍ່ມີອິນເຕີເນັດ — ເກັບຮູບໄວ້ໃນເຄື່ອງ ຈະສົ່ງເອງເມື່ອມີເນັດ', 'warning');
    }
    void refreshToday();
    void refreshHistory();
  };

  const toggleAutoSave = (on: boolean) => {
    setAutoSave(on);
    setAutoSaveState(on);
  };

  const navButton = (value: Tab, label: string, icon: string, activeIcon: string) => {
    const active = tab === value;
    return (
      <button
        type="button"
        onClick={() => setTab(value)}
        className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium ${active ? 'text-wine-600' : 'text-stone-500'}`}
      >
        <IonIcon icon={active ? activeIcon : icon} className="text-2xl" />
        {label}
        {value === 'history' && queued.length > 0 && (
          <span className="absolute right-[30%] top-1 min-w-[18px] rounded-full bg-amber-500 px-1 text-[11px] font-bold leading-[18px] text-white">
            {queued.length}
          </span>
        )}
      </button>
    );
  };

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar style={{ '--background': '#ffffff' } as React.CSSProperties} className="border-b border-stone-100">
          <div className="flex items-center gap-3 px-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wine-600 text-lg font-bold text-white">{initials}</div>
            <div className="min-w-0 leading-tight">
              <div className="truncate font-semibold">{name || '-'}</div>
              <div className="text-xs text-stone-500">ລະຫັດ {employee?.employeeCode ?? '-'}</div>
            </div>
            <div className="ml-auto hidden md:block">
              <IonSegment value={tab} onIonChange={(e) => setTab(e.detail.value as Tab)} className="w-72">
                <IonSegmentButton value="camera">
                  <IonLabel>ຖ່າຍຮູບ</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="history">
                  <IonLabel>ປະຫວັດ{queued.length ? ` (${queued.length})` : ''}</IonLabel>
                </IonSegmentButton>
              </IonSegment>
            </div>
          </div>
          <IonButtons slot="end">
            <IonButton id="me-menu" aria-label="ເມນູ">
              <IonIcon icon={ellipsisVertical} />
            </IonButton>
          </IonButtons>
          <IonPopover trigger="me-menu" dismissOnSelect={false}>
            <IonList lines="full">
              <IonItem>
                <IonToggle checked={autoSave} onIonChange={(e) => toggleAutoSave(e.detail.checked)}>
                  ບັນທຶກຮູບລົງເຄື່ອງອັດຕະໂນມັດ
                </IonToggle>
              </IonItem>
              <IonItem button detail={false} onClick={() => signOut()}>
                <IonIcon slot="start" icon={logOutOutline} color="danger" />
                <IonLabel color="danger">ອອກຈາກລະບົບ</IonLabel>
              </IonItem>
            </IonList>
          </IonPopover>
        </IonToolbar>
      </IonHeader>

      <IonContent scrollY={tab === 'history'} style={{ '--background': tab === 'camera' ? '#111' : '#FAF9F7' } as React.CSSProperties}>
        {tab === 'camera' ? (
          <div className="h-full md:bg-cream">
            <CameraView
              active
              today={today}
              employeeCode={employee?.employeeCode}
              onCaptured={(photo, kind) => setReview({ photo, date: currentDay, kind })}
              openCameraApp={() => {
                target.current = { date: currentDay, kind: nextKind(today) };
                picker.openCameraApp();
              }}
              openGallery={() => {
                target.current = {};
                picker.openGallery();
              }}
            />
          </div>
        ) : (
          <HistoryView
            evidence={evidence}
            queued={queued}
            currentDay={today?.date ?? null}
            onOpen={setDetail}
            onAdd={(date, kind) => chooseSource({ date, kind }, `ເພີ່ມຮູບ${KIND_LABEL[kind]}`)}
            onBackdate={() => chooseSource({}, 'ອັບໂຫຼດຍ້ອນຫຼັງ — ເລືອກວັນໄດ້ໃນໜ້າຕໍ່ໄປ')}
            onRefresh={async () => {
              await Promise.all([refreshToday(), refreshHistory(), sendWaiting()]);
            }}
            onSendQueued={() => void sendWaiting()}
            onDropQueued={(id) => void removeQueued(id)}
          />
        )}
        {picker.inputs}
      </IonContent>

      <IonFooter className="ion-no-border md:hidden">
        <div className="flex border-t border-stone-200 bg-white pb-safe">
          {navButton('camera', 'ຖ່າຍຮູບ', cameraOutline, camera)}
          {navButton('history', 'ປະຫວັດ', timeOutline, time)}
        </div>
      </IonFooter>

      <ReviewModal
        photo={review?.photo ?? null}
        date={review?.date ?? currentDay}
        kind={review?.kind ?? 'in'}
        editId={review?.editId}
        maxDate={currentDay}
        employeeCode={employee?.employeeCode}
        slotTaken={slotTaken}
        onRetake={() => {
          const r = review;
          setReview(null);
          if (r?.editId) chooseSource({ date: r.date, kind: r.kind, editId: r.editId }, 'ປ່ຽນຮູບ');
          else if (tab === 'history') chooseSource({ date: r?.date, kind: r?.kind }, `ເພີ່ມຮູບ${KIND_LABEL[r?.kind ?? 'in']}`);
        }}
        onClose={() => setReview(null)}
        onDone={done}
      />

      <EvidenceDetailModal
        evidence={detail}
        maxDate={currentDay}
        employeeCode={employee?.employeeCode}
        onClose={() => setDetail(null)}
        onReplacePhoto={(e) => chooseSource({ date: e.date, kind: e.kind, editId: e._id }, 'ປ່ຽນຮູບ')}
        onSaved={(e) => {
          setDetail(e);
          notify('ບັນທຶກການແກ້ໄຂແລ້ວ ✓');
          void refreshToday();
          void refreshHistory();
        }}
      />
    </IonPage>
  );
};
