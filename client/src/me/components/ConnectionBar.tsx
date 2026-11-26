import { IonIcon, IonSpinner } from '@ionic/react';
import { alertCircle, cloudDoneOutline, cloudOffline, handLeftOutline } from 'ionicons/icons';
import type { Connection } from '../lib/connection';

interface Props {
  connection: Connection;
  // Photos on the phone: on their way, left unsent on the review sheet, turned
  // down by the server.
  waiting: number;
  drafts: number;
  failed: number;
  sending: boolean;
  // Just came back: shown for a moment.
  restored: boolean;
  onOpen: () => void;
}

const bar = 'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm leading-snug';

// Under the header on every screen: whether the phone is online, and what
// still has to reach the server. Nothing to say → nothing shown.
export const ConnectionBar: React.FC<Props> = ({ connection, waiting, drafts, failed, sending, restored, onOpen }) => (
  <div aria-live="polite">
    {connection !== 'online' ? (
      <div className={`${bar} bg-stone-800 text-white`} data-connection={connection}>
        <IonIcon icon={cloudOffline} className="shrink-0 text-2xl text-amber-300" />
        <div className="min-w-0">
          <div className="font-semibold">{connection === 'offline' ? 'ອອຟລາຍ — ເຄື່ອງນີ້ບໍ່ມີອິນເຕີເນັດ' : 'ຕິດຕໍ່ລະບົບບໍ່ໄດ້ — ເນັດອາດບໍ່ດີ'}</div>
          <div className="text-xs text-white/80">
            ຖ່າຍຮູບໄດ້ຕາມປົກກະຕິ — ຮູບເກັບໄວ້ໃນເຄື່ອງ ແລະ ຈະສົ່ງເອງເມື່ອມີເນັດ
            {waiting > 0 && <b className="text-amber-300"> · ລໍຖ້າສົ່ງ {waiting} ຮູບ</b>}
          </div>
        </div>
      </div>
    ) : waiting > 0 ? (
      <div className={`${bar} bg-amber-100 text-amber-900`} data-connection="sending">
        <IonSpinner name="crescent" className="h-5 w-5 shrink-0" />
        <div className="font-medium">{sending ? `ກຳລັງສົ່ງ ${waiting} ຮູບ… ຢ່າຟ້າວປິດແອັບ` : `ລໍຖ້າສົ່ງ ${waiting} ຮູບ…`}</div>
      </div>
    ) : restored ? (
      <div className={`${bar} bg-emerald-600 text-white`} data-connection="restored">
        <IonIcon icon={cloudDoneOutline} className="shrink-0 text-xl" />
        <div className="font-medium">ເນັດກັບມາແລ້ວ</div>
      </div>
    ) : null}
    {failed > 0 && (
      <button type="button" onClick={onOpen} className={`${bar} bg-red-600 text-white`} data-photos="failed">
        <IonIcon icon={alertCircle} className="shrink-0 text-xl" />
        <span className="font-medium">ມີ {failed} ຮູບສົ່ງບໍ່ໄດ້ — ກົດບ່ອນນີ້ເພື່ອແກ້</span>
      </button>
    )}
    {drafts > 0 && (
      <button type="button" onClick={onOpen} className={`${bar} bg-amber-500 text-white`} data-photos="drafts">
        <IonIcon icon={handLeftOutline} className="shrink-0 text-xl" />
        <span className="font-medium">ມີ {drafts} ຮູບຍັງບໍ່ໄດ້ກົດສົ່ງ — ກົດບ່ອນນີ້ເພື່ອສົ່ງ</span>
      </button>
    )}
  </div>
);
