import { useEffect, useMemo, useState } from 'react';
import { IonButton, IonIcon, IonRefresher, IonRefresherContent, IonSpinner } from '@ionic/react';
import { addOutline, cloudOfflineOutline, cloudUploadOutline, createOutline, imagesOutline, refreshOutline, trashOutline } from 'ionicons/icons';
import { imageSrc, type Evidence, type Kind } from '../lib/evidence';
import type { QueuedPhoto } from '../lib/queue';
import { KIND_LABEL, shiftDayLabel, timeLabel } from '../lib/dates';

interface Props {
  evidence: Evidence[] | null;
  queued: QueuedPhoto[];
  // The one on its way right now.
  sending: string | null;
  online: boolean;
  currentDay: string | null;
  onOpen: (evidence: Evidence) => void;
  onAdd: (date: string, kind: Kind) => void;
  onBackdate: () => void;
  onRefresh: () => Promise<void>;
  onSendQueued: () => void;
  onOpenQueued: (item: QueuedPhoto) => void;
  onSendDraft: (item: QueuedPhoto) => void;
  onDropQueued: (item: QueuedPhoto) => void;
}

const Badge: React.FC<{ tone: 'amber' | 'blue' | 'red'; children: React.ReactNode }> = ({ tone, children }) => {
  const tones = { amber: 'bg-amber-500', blue: 'bg-sky-600', red: 'bg-red-600' };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow ${tones[tone]}`}>{children}</span>;
};

const useBlobUrl = (blob?: Blob) => {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return undefined;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return blob ? url : undefined;
};

// The photo for this slot that's still on the phone.
const WaitingTile: React.FC<{ kind: Kind; item: QueuedPhoto }> = ({ kind, item }) => {
  const url = useBlobUrl(item.thumb);
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-stone-200 text-left">
      <img src={url} alt={KIND_LABEL[kind]} className="h-full w-full object-cover opacity-70" />
      <div className="absolute left-2 top-2">
        <Badge tone="amber">{item.draft && !item.sendAfter ? 'ຍັງບໍ່ໄດ້ກົດສົ່ງ' : 'ລໍຖ້າສົ່ງ'}</Badge>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-white">
        <div className="text-sm font-semibold">{KIND_LABEL[kind]}</div>
        <div className="text-xs text-white/85">ຖ່າຍ {timeLabel(item.takenAt)}</div>
      </div>
    </div>
  );
};

const Tile: React.FC<{ kind: Kind; evidence?: Evidence; onOpen: () => void; onAdd: () => void }> = ({ kind, evidence, onOpen, onAdd }) =>
  evidence ? (
    <button type="button" onClick={onOpen} className="group relative aspect-[4/3] overflow-hidden rounded-2xl bg-stone-200 text-left">
      <img src={imageSrc(evidence.thumbUrl)} alt={KIND_LABEL[kind]} loading="lazy" className="h-full w-full object-cover transition group-active:scale-95" />
      <div className="absolute left-2 top-2 flex flex-wrap gap-1">
        {evidence.backdated && <Badge tone="amber">ຍ້ອນຫຼັງ</Badge>}
        {evidence.editedAt && <Badge tone="blue">ແກ້ໄຂ</Badge>}
        {evidence.duplicate && <Badge tone="red">ຮູບຊ້ຳ</Badge>}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-white">
        <div className="text-sm font-semibold">{KIND_LABEL[kind]}</div>
        <div className="text-xs text-white/85">ຖ່າຍ {timeLabel(evidence.takenAt)}</div>
      </div>
    </button>
  ) : (
    <button
      type="button"
      onClick={onAdd}
      className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50 text-stone-500 active:bg-stone-100"
    >
      <IonIcon icon={addOutline} className="text-2xl" />
      <span className="text-sm">ເພີ່ມຮູບ{KIND_LABEL[kind]}</span>
    </button>
  );

const QueuedThumb: React.FC<{ item: QueuedPhoto }> = ({ item }) => {
  const url = useBlobUrl(item.thumb);
  return <img src={url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />;
};

// Every shift with its two photos, newest first — tap one to see it big,
// change it, or add a missing one.
export const HistoryView: React.FC<Props> = ({
  evidence,
  queued,
  sending,
  online,
  currentDay,
  onOpen,
  onAdd,
  onBackdate,
  onRefresh,
  onSendQueued,
  onOpenQueued,
  onSendDraft,
  onDropQueued,
}) => {
  const days = useMemo(() => {
    const byDate = new Map<string, Partial<Record<Kind, Evidence>>>();
    if (currentDay) byDate.set(currentDay, {});
    for (const e of evidence ?? []) byDate.set(e.date, { ...byDate.get(e.date), [e.kind]: e });
    for (const q of queued) if (q.date && !byDate.has(q.date)) byDate.set(q.date, {});
    return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [evidence, currentDay, queued]);
  const waitingFor = (date: string, kind: Kind) => queued.filter((q) => q.date === date && q.kind === kind && !q.editId && !q.error).pop();

  return (
    <>
      <IonRefresher slot="fixed" onIonRefresh={(e) => void onRefresh().finally(() => e.detail.complete())}>
        <IonRefresherContent />
      </IonRefresher>
      <div className="mx-auto w-full max-w-6xl px-4 pb-6 pt-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-xl font-bold">ປະຫວັດການອັບໂຫຼດ</h2>
          <IonButton fill="outline" shape="round" size="small" onClick={onBackdate}>
            <IonIcon slot="start" icon={imagesOutline} /> ອັບໂຫຼດຍ້ອນຫຼັງ
          </IonButton>
        </div>

        {queued.length > 0 && (
          <div className="mb-4 rounded-3xl bg-amber-50 p-3 ring-1 ring-amber-200" data-queue>
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 font-semibold text-amber-900">
                <IonIcon icon={cloudOfflineOutline} /> ຍັງຢູ່ໃນເຄື່ອງ {queued.length} ຮູບ
              </div>
              <IonButton size="small" shape="round" color="warning" onClick={onSendQueued}>
                <IonIcon slot="start" icon={cloudUploadOutline} /> ສົ່ງດຽວນີ້
              </IonButton>
            </div>
            <div className="space-y-2">
              {queued.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-x-3 rounded-2xl bg-white p-2">
                  <QueuedThumb item={item} />
                  <div className="min-w-[60%] flex-1 text-sm">
                    <div className="font-medium">
                      {item.kind ? KIND_LABEL[item.kind] : 'ຮູບ'} {item.date ? `· ${shiftDayLabel(item.date)}` : ''}
                    </div>
                    <div className={item.error ? 'text-red-600' : 'text-stone-500'}>
                      {item.error ??
                        `ຖ່າຍ ${timeLabel(item.takenAt)} · ${
                          item.id === sending
                            ? 'ກຳລັງສົ່ງ…'
                            : item.draft && !item.sendAfter
                              ? 'ຍັງບໍ່ໄດ້ກົດສົ່ງ'
                              : online
                                ? 'ຈະສົ່ງເອງ'
                                : 'ຈະສົ່ງເອງເມື່ອມີເນັດ'
                        }`}
                    </div>
                  </div>
                  {(item.error || (item.draft && !item.sendAfter)) && item.id !== sending && (
                    <div className="ml-auto flex items-center">
                      <IonButton fill="clear" size="small" onClick={() => onOpenQueued(item)}>
                        <IonIcon slot="start" icon={createOutline} /> ແກ້ໄຂ
                      </IonButton>
                      <IonButton fill="clear" size="small" color="danger" onClick={() => onDropQueued(item)}>
                        <IonIcon slot="start" icon={trashOutline} /> ລຶບ
                      </IonButton>
                      <IonButton fill="clear" size="small" color="success" onClick={() => onSendDraft(item)} aria-label={item.error ? 'ລອງໃໝ່' : 'ສົ່ງ'}>
                        <IonIcon slot="start" icon={item.error ? refreshOutline : cloudUploadOutline} /> {item.error ? 'ລອງໃໝ່' : 'ສົ່ງ'}
                      </IonButton>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {evidence === null && !online ? (
          <div className="rounded-3xl bg-white px-4 py-10 text-center text-stone-500 ring-1 ring-stone-100">ອອຟລາຍ — ປະຫວັດຈະສະແດງເມື່ອມີເນັດ</div>
        ) : evidence === null ? (
          <div className="flex justify-center py-16">
            <IonSpinner name="crescent" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {days.map(([date, slots]) => (
              <section key={date} className="rounded-3xl bg-white p-3 shadow-sm ring-1 ring-stone-100">
                <div className="mb-2 flex items-center justify-between px-1">
                  <h3 className="m-0 text-base font-semibold">{shiftDayLabel(date)}</h3>
                  {date === currentDay && <span className="rounded-full bg-wine-50 px-2.5 py-0.5 text-xs font-semibold text-wine-700">ກະປັດຈຸບັນ</span>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(['in', 'out'] as const).map((kind) => {
                    const waiting = !slots[kind] && waitingFor(date, kind);
                    return waiting ? (
                      <WaitingTile key={kind} kind={kind} item={waiting} />
                    ) : (
                      <Tile key={kind} kind={kind} evidence={slots[kind]} onOpen={() => slots[kind] && onOpen(slots[kind]!)} onAdd={() => onAdd(date, kind)} />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
