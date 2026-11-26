import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { camera, cameraOutline, cloudUploadOutline, ellipsisVertical, imagesOutline, logOutOutline, saveOutline, timeOutline, time, trashOutline } from 'ionicons/icons';
import dayjs from 'dayjs';
import { signOut, type MeUser } from '../api';
import { flushQueue, getToday, hold, isDue, isMine, listEvidence, release, sendingId, type Evidence, type Kind } from '../lib/evidence';
import { enqueue, newPhotoId, onQueueChanged, patchQueued, queuedPhotos, removeQueued, requestBackgroundSend, type QueuedPhoto } from '../lib/queue';
import { connection as connectionNow, useConnection } from '../lib/connection';
import { keepToday, keptToday, nextKind, save, shiftNow, withSent } from '../lib/shift';
import type { PreparedPhoto } from '../lib/image';
import { autoSaveEnabled, setAutoSave } from '../lib/device';
import { KIND_LABEL } from '../lib/dates';
import { CameraView } from './CameraView';
import { HistoryView } from './HistoryView';
import { ConnectionBar } from '../components/ConnectionBar';
import { ReviewModal, type ReviewPhoto, type SendFields } from '../components/ReviewModal';
import { EvidenceDetailModal } from '../components/EvidenceDetailModal';
import { usePhotoPicker } from '../components/usePhotoPicker';

type Tab = 'camera' | 'history';

// Where a photo picked from the gallery/camera app goes.
interface Target {
  date?: string;
  kind?: Kind;
  editId?: string;
}

// How long a photo of the shift in progress waits on the review sheet before
// it goes by itself (components/ReviewModal.tsx counts down the same).
const AUTO_SEND_MS = 10000;
// An out so soon after the in is more likely the in taken again (a blurred
// one): it waits for a tap.
const OUT_AFTER_HOURS = 3;
// How often whatever is waiting is tried again while the app is open.
const RETRY_MS = 15000;

export const Shell: React.FC<{ user: MeUser }> = ({ user }) => {
  const employee = user.employee;
  const owner = employee?._id ?? user.id;
  const name = `${employee?.firstName ?? ''} ${employee?.lastName ?? ''}`.trim();
  const initials = (employee?.firstName ?? '?').slice(0, 1);

  const [tab, setTab] = useState<Tab>('camera');
  // What the server last said about the shift in progress, kept on the phone.
  const [kept, setKept] = useState(() => keptToday(owner));
  const [evidence, setEvidence] = useState<Evidence[] | null>(null);
  const [queued, setQueued] = useState<QueuedPhoto[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewPhoto | null>(null);
  const [detail, setDetail] = useState<Evidence | null>(null);
  const [autoSave, setAutoSaveState] = useState(autoSaveEnabled());
  const [restored, setRestored] = useState(false);
  // Moves the shift-day on while the app stays open.
  const [tick, setTick] = useState(0);
  const connection = useConnection();
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

  const refreshToday = useCallback(() => getToday().then((t) => setKept(keepToday(owner, t))).catch(() => undefined), [owner]);
  const refreshHistory = useCallback(() => listEvidence().then(setEvidence).catch(() => undefined), []);
  const refreshQueue = useCallback(
    () =>
      queuedPhotos().then((all) => {
        setQueued(all.filter((q) => isMine(q, owner)));
        setSending(sendingId());
      }),
    [owner]
  );

  // Sends whatever is waiting; says so once it's there.
  const deliver = useCallback(async () => {
    const sent = await flushQueue(owner);
    if (!sent.length) return;
    setKept((k) => {
      const next = withSent(k, sent);
      if (next && next !== k) save(next);
      return next;
    });
    void notify(sent.length === 1 ? `ສົ່ງຮູບ${KIND_LABEL[sent[0].kind]}ແລ້ວ ✓` : `ສົ່ງຮູບທີ່ລໍຖ້າແລ້ວ ${sent.length} ຮູບ ✓`);
    setDetail((d) => (d ? sent.find((e) => e._id === d._id) ?? d : d));
    void refreshToday();
    void refreshHistory();
  }, [owner, notify, refreshHistory, refreshToday]);

  useEffect(() => {
    void refreshToday();
    void refreshHistory();
    void refreshQueue();
    void deliver();
    const offQueue = onQueueChanged(() => void refreshQueue());
    const onVisible = () => {
      if (document.hidden) return;
      setTick((n) => n + 1);
      void refreshToday();
      void deliver();
    };
    // Tried again every so often — a phone doesn't always notice by itself
    // that the internet is back.
    const retry = setInterval(() => {
      if (document.hidden) return;
      setTick((n) => n + 1);
      if (connectionNow() !== 'offline') void deliver();
    }, RETRY_MS);
    // The service worker asks the open app to send rather than doing it itself.
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'me-flush') void deliver();
    };
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      offQueue();
      clearInterval(retry);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [deliver, refreshHistory, refreshQueue, refreshToday]);

  // Back online: everything on screen is read again and what waited goes out.
  const before = useRef(connection);
  useEffect(() => {
    const was = before.current;
    before.current = connection;
    if (connection !== 'online') {
      setRestored(false);
      return undefined;
    }
    if (was === 'online') return undefined;
    setRestored(true);
    void refreshToday();
    void refreshHistory();
    void deliver();
    const timer = setTimeout(() => setRestored(false), 4000);
    return () => clearTimeout(timer);
  }, [connection, deliver, refreshHistory, refreshToday]);

  // Opening the history always shows it fresh.
  useEffect(() => {
    if (tab === 'history') void refreshHistory();
  }, [tab, refreshHistory]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => shiftNow(kept, queued.filter((q) => q.id !== review?.id)), [kept, queued, review, tick]);
  const currentDay = now?.date ?? dayjs().format('YYYY-MM-DD');

  const slotTaken = (date: string, kind: Kind) => {
    if (now && date === now.date) return !!now[kind];
    return !!evidence?.some((e) => e.date === date && e.kind === kind) || queued.some((q) => q.id !== review?.id && q.date === date && q.kind === kind && !q.editId);
  };

  // On the phone first, then on screen: from here on it can't be lost.
  const startReview = (photo: PreparedPhoto, place: { date: string; kind: Kind; editId?: string }, own: boolean) => {
    const id = newPhotoId();
    // A photo of the shift in progress goes by itself; one that would take the
    // place of another, might be the same one again, or was picked from the
    // gallery, waits for a tap.
    const unplaced = own && !now;
    const tooSoon = place.kind === 'out' && !!now?.in?.takenAt && dayjs(photo.takenAt).diff(now.in.takenAt, 'hour', true) < OUT_AFTER_HOURS;
    const autoSend = unplaced
      ? !queued.some((q) => !q.date && !q.editId)
      : own && !!now && place.date === now.date && !slotTaken(place.date, place.kind) && !tooSoon;
    hold(id);
    void enqueue({
      id,
      owner,
      draft: true,
      takenAt: photo.takenAt,
      photo: photo.photo,
      thumb: photo.thumb,
      editId: place.editId,
      ...(unplaced ? {} : { date: place.date, kind: place.kind }),
      ...(autoSend ? { sendAfter: Date.now() + AUTO_SEND_MS } : {}),
    }).then(requestBackgroundSend);
    setReview({ id, photo: photo.photo, previewUrl: photo.previewUrl, takenAt: photo.takenAt, ...place, autoSend, unplaced });
  };

  const endReview = (r: ReviewPhoto) => {
    setReview(null);
    setTimeout(() => URL.revokeObjectURL(r.previewUrl), 1000);
  };

  const sendReview = (r: ReviewPhoto, fields: SendFields) => {
    endReview(r);
    void patchQueued(r.id, { ...fields, draft: false, sendAfter: undefined, error: undefined }).then(() => {
      release(r.id);
      requestBackgroundSend();
      return deliver();
    });
    if (connectionNow() !== 'online') void notify('ອອຟລາຍ — ເກັບຮູບໄວ້ໃນເຄື່ອງແລ້ວ ຈະສົ່ງເອງເມື່ອມີເນັດ', 'warning');
  };

  const keepForLater = (r: ReviewPhoto, fields: SendFields) => {
    endReview(r);
    void patchQueued(r.id, { ...fields, draft: true, sendAfter: undefined }).then(() => release(r.id));
  };

  const throwAway = async (id: string) => {
    await removeQueued(id);
    release(id);
  };

  const askBeforeClosing = (r: ReviewPhoto, fields: SendFields) =>
    void actionSheet({
      header: 'ຮູບນີ້ຍັງບໍ່ໄດ້ສົ່ງ',
      buttons: [
        { text: 'ສົ່ງດຽວນີ້', icon: cloudUploadOutline, handler: () => sendReview(r, fields) },
        { text: 'ເກັບໄວ້ສົ່ງພາຍຫຼັງ', icon: saveOutline, handler: () => keepForLater(r, fields) },
        {
          text: 'ຖິ້ມຮູບນີ້',
          role: 'destructive',
          icon: trashOutline,
          handler: () => {
            endReview(r);
            void throwAway(r.id);
          },
        },
        { text: 'ກັບໄປເບິ່ງຮູບ', role: 'cancel' },
      ],
    });

  const picker = usePhotoPicker(
    (photo) => {
      const t = target.current;
      // A picked photo with no shift named: the day it was taken (never later
      // than the current shift).
      const takenDay = dayjs(photo.takenAt).format('YYYY-MM-DD');
      const date = t.date ?? (takenDay < currentDay ? takenDay : currentDay);
      startReview(photo, { date, kind: t.kind ?? (date === currentDay ? nextKind(now) : 'in'), editId: t.editId }, false);
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

  // A photo left unsent, or one the server turned down: looked at again.
  const openQueued = (item: QueuedPhoto) => {
    hold(item.id);
    setReview({
      id: item.id,
      photo: item.photo,
      previewUrl: URL.createObjectURL(item.photo),
      takenAt: item.takenAt,
      date: item.date ?? currentDay,
      kind: item.kind ?? nextKind(now),
      note: item.note,
      editId: item.editId,
      autoSend: false,
      unplaced: !item.date && !item.kind && !item.error,
    });
  };
  const sendDraft = (item: QueuedPhoto) =>
    void patchQueued(item.id, { draft: false, sendAfter: undefined, error: undefined }).then(() => {
      requestBackgroundSend();
      return deliver();
    });
  const dropQueued = (item: QueuedPhoto) =>
    void actionSheet({
      header: 'ລຶບຮູບນີ້ອອກຈາກເຄື່ອງບໍ? ຮູບນີ້ຍັງບໍ່ໄດ້ສົ່ງໃຫ້ HR',
      buttons: [
        { text: 'ລຶບຮູບ', role: 'destructive', icon: trashOutline, handler: () => void throwAway(item.id) },
        { text: 'ຍົກເລີກ', role: 'cancel' },
      ],
    });

  const mine = queued.filter((q) => q.id !== review?.id);
  const failed = mine.filter((q) => q.error).length;
  const drafts = mine.filter((q) => q.draft && !q.sendAfter && !q.error).length;
  const waiting = mine.length - failed - drafts;

  const leave = () => {
    if (!queued.length) {
      signOut();
      return;
    }
    void actionSheet({
      header: `ຍັງມີ ${queued.length} ຮູບບໍ່ໄດ້ສົ່ງ — ຮູບຈະຢູ່ໃນເຄື່ອງ ແລະ ຈະສົ່ງເມື່ອທ່ານເຂົ້າລະບົບອີກ`,
      buttons: [
        { text: 'ສົ່ງກ່ອນ', icon: cloudUploadOutline, handler: () => void deliver() },
        { text: 'ອອກຈາກລະບົບ', role: 'destructive', icon: logOutOutline, handler: () => signOut() },
        { text: 'ຍົກເລີກ', role: 'cancel' },
      ],
    });
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
        {value === 'history' && mine.length > 0 && (
          <span className="absolute right-[30%] top-1 min-w-[18px] rounded-full bg-amber-500 px-1 text-[11px] font-bold leading-[18px] text-white">
            {mine.length}
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
              <div className="text-xs text-stone-500">
                ລະຫັດ {employee?.employeeCode ?? '-'}
                {user.username ? ` · ${user.username}` : ''}
              </div>
            </div>
            <div className="ml-auto hidden md:block">
              <IonSegment value={tab} onIonChange={(e) => setTab(e.detail.value as Tab)} className="w-72">
                <IonSegmentButton value="camera">
                  <IonLabel>ຖ່າຍຮູບ</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="history">
                  <IonLabel>ປະຫວັດ{mine.length ? ` (${mine.length})` : ''}</IonLabel>
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
              <IonItem button detail={false} onClick={leave}>
                <IonIcon slot="start" icon={logOutOutline} color="danger" />
                <IonLabel color="danger">ອອກຈາກລະບົບ</IonLabel>
              </IonItem>
            </IonList>
          </IonPopover>
        </IonToolbar>
        <ConnectionBar
          connection={connection}
          waiting={waiting}
          drafts={drafts}
          failed={failed}
          sending={sending !== null || mine.some((q) => isDue(q))}
          restored={restored}
          onOpen={() => setTab('history')}
        />
      </IonHeader>

      <IonContent scrollY={tab === 'history'} style={{ '--background': tab === 'camera' ? '#111' : '#FAF9F7' } as React.CSSProperties}>
        {tab === 'camera' ? (
          <div className="h-full md:bg-cream">
            <CameraView
              active
              now={now}
              loading={connection === 'online'}
              currentDay={currentDay}
              employeeCode={employee?.employeeCode}
              onCaptured={(photo, kind) => startReview(photo, { date: currentDay, kind }, true)}
              openCameraApp={() => {
                target.current = { date: currentDay, kind: nextKind(now) };
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
            queued={mine}
            sending={sending}
            online={connection === 'online'}
            currentDay={now?.date ?? null}
            onOpen={setDetail}
            onAdd={(date, kind) => chooseSource({ date, kind }, `ເພີ່ມຮູບ${KIND_LABEL[kind]}`)}
            onBackdate={() => chooseSource({}, 'ອັບໂຫຼດຍ້ອນຫຼັງ — ເລືອກວັນໄດ້ໃນໜ້າຕໍ່ໄປ')}
            onRefresh={async () => {
              await Promise.all([refreshToday(), refreshHistory(), deliver()]);
            }}
            onSendQueued={() => void deliver()}
            onOpenQueued={openQueued}
            onSendDraft={sendDraft}
            onDropQueued={dropQueued}
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
        review={review}
        connection={connection}
        maxDate={currentDay}
        employeeCode={employee?.employeeCode}
        slotTaken={slotTaken}
        onSend={sendReview}
        onRetake={(r) => {
          endReview(r);
          void throwAway(r.id);
          if (r.editId) chooseSource({ date: r.date, kind: r.kind, editId: r.editId }, 'ປ່ຽນຮູບ');
          else if (tab === 'history') chooseSource({ date: r.date, kind: r.kind }, `ເພີ່ມຮູບ${KIND_LABEL[r.kind]}`);
        }}
        onClose={askBeforeClosing}
      />

      <EvidenceDetailModal
        evidence={detail}
        maxDate={currentDay}
        employeeCode={employee?.employeeCode}
        onClose={() => setDetail(null)}
        onReplacePhoto={(e) => chooseSource({ date: e.date, kind: e.kind, editId: e._id }, 'ປ່ຽນຮູບ')}
        onSaved={(e) => {
          setDetail(e);
          void notify('ບັນທຶກການແກ້ໄຂແລ້ວ ✓');
          void refreshToday();
          void refreshHistory();
        }}
      />
    </IonPage>
  );
};
