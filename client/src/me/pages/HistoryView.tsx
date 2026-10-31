import { useEffect, useMemo, useState } from 'react';
import { IonButton, IonIcon, IonRefresher, IonRefresherContent, IonSpinner } from '@ionic/react';
import { addOutline, cloudOfflineOutline, cloudUploadOutline, imagesOutline, trashOutline } from 'ionicons/icons';
import { imageSrc, type Evidence, type Kind } from '../lib/evidence';
import type { QueuedPhoto } from '../lib/queue';
import { KIND_LABEL, shiftDayLabel, timeLabel } from '../lib/dates';

interface Props {
  evidence: Evidence[] | null;
  queued: QueuedPhoto[];
  currentDay: string | null;
  onOpen: (evidence: Evidence) => void;
  onAdd: (date: string, kind: Kind) => void;
  onBackdate: () => void;
  onRefresh: () => Promise<void>;
  onSendQueued: () => void;
  onDropQueued: (id: string) => void;
}

const Badge: React.FC<{ tone: 'amber' | 'blue' | 'red'; children: React.ReactNode }> = ({ tone, children }) => {
  const tones = { amber: 'bg-amber-500', blue: 'bg-sky-600', red: 'bg-red-600' };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow ${tones[tone]}`}>{children}</span>;
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
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(item.thumb);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [item.thumb]);
  return <img src={url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />;
};

// Every shift with its two photos, newest first — tap one to see it big,
// change it, or add a missing one.
export const HistoryView: React.FC<Props> = ({ evidence, queued, currentDay, onOpen, onAdd, onBackdate, onRefresh, onSendQueued, onDropQueued }) => {
  const days = useMemo(() => {
    const byDate = new Map<string, Partial<Record<Kind, Evidence>>>();
    if (currentDay) byDate.set(currentDay, {});
    for (const e of evidence ?? []) byDate.set(e.date, { ...byDate.get(e.date), [e.kind]: e });
    return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [evidence, currentDay]);

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
          <div className="mb-4 rounded-3xl bg-amber-50 p-3 ring-1 ring-amber-200">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 font-semibold text-amber-900">
                <IonIcon icon={cloudOfflineOutline} /> ລໍຖ້າສົ່ງ {queued.length} ຮູບ
              </div>
              <IonButton size="small" shape="round" color="warning" onClick={onSendQueued}>
                <IonIcon slot="start" icon={cloudUploadOutline} /> ສົ່ງດຽວນີ້
              </IonButton>
            </div>
            <div className="space-y-2">
              {queued.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-white p-2">
                  <QueuedThumb item={item} />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium">
                      {item.kind ? KIND_LABEL[item.kind] : 'ຮູບ'} {item.date ? `· ${shiftDayLabel(item.date)}` : ''}
                    </div>
                    <div className={item.error ? 'text-red-600' : 'text-stone-500'}>{item.error ?? `ຖ່າຍ ${timeLabel(item.takenAt)} · ຈະສົ່ງເອງເມື່ອມີເນັດ`}</div>
                  </div>
                  {item.error && (
                    <IonButton fill="clear" color="danger" onClick={() => onDropQueued(item.id)} aria-label="ລຶບ">
                      <IonIcon icon={trashOutline} />
                    </IonButton>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {evidence === null ? (
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
                  {(['in', 'out'] as const).map((kind) => (
                    <Tile key={kind} kind={kind} evidence={slots[kind]} onOpen={() => slots[kind] && onOpen(slots[kind]!)} onAdd={() => onAdd(date, kind)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
