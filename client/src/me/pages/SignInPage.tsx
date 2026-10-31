import { useState } from 'react';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonInputPasswordToggle,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSpinner,
} from '@ionic/react';
import { alertCircle, cameraOutline, shieldCheckmarkOutline } from 'ionicons/icons';
import { meApi, signIn, errorMessage } from '../api';

type Mode = 'login' | 'setup';

const Field: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-1 transition focus-within:border-wine-600 focus-within:bg-white focus-within:ring-2 focus-within:ring-wine-100">
    {children}
  </div>
);

// Sign-in for the employees' app. "Set password" is both the first time and
// after HR resets a forgotten one: employee code + the phone number HR has on
// file, then a password of their own (server: routes/auth.js employee-setup).
export const SignInPage: React.FC<{ onSignedIn: () => void }> = ({ onSignedIn }) => {
  const [mode, setMode] = useState<Mode>('login');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchTo = (next: Mode) => {
    setError(null);
    setMode(next);
  };

  const login = async () => {
    if (!code.trim() || !password) return setError('ກະລຸນາປ້ອນລະຫັດພະນັກງານ ແລະ ລະຫັດຜ່ານ');
    setError(null);
    setBusy(true);
    try {
      const { data } = await meApi.post('/auth/login', { employeeCode: code.trim(), password });
      signIn(data.token, data.user);
      onSignedIn();
    } catch (err: any) {
      if (err?.response?.data?.needsSetup) {
        setMode('setup');
        setError('ບັນຊີນີ້ຍັງບໍ່ໄດ້ຕັ້ງລະຫັດຜ່ານ — ກະລຸນາຕັ້ງລະຫັດຜ່ານກ່ອນ');
      } else {
        setError(errorMessage(err, 'ເຂົ້າລະບົບບໍ່ສຳເລັດ — ກວດອິນເຕີເນັດແລ້ວລອງໃໝ່'));
      }
    } finally {
      setBusy(false);
    }
  };

  const setup = async () => {
    if (!code.trim() || !phone.trim() || !newPassword) return setError('ກະລຸນາປ້ອນຂໍ້ມູນໃຫ້ຄົບ');
    if (newPassword.length < 6) return setError('ລະຫັດຜ່ານຕ້ອງມີຢ່າງໜ້ອຍ 6 ຕົວ');
    if (newPassword !== confirm) return setError('ລະຫັດຜ່ານທັງສອງບໍ່ກົງກັນ');
    setError(null);
    setBusy(true);
    try {
      const { data } = await meApi.post('/auth/employee-setup', { employeeCode: code.trim(), phone, newPassword });
      signIn(data.token, data.user);
      onSignedIn();
    } catch (err: any) {
      setError(errorMessage(err, 'ຕັ້ງລະຫັດຜ່ານບໍ່ສຳເລັດ — ກວດອິນເຕີເນັດແລ້ວລອງໃໝ່'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <IonPage>
      <IonContent fullscreen>
        <div className="me-gradient flex min-h-full items-center justify-center px-4 py-10">
          <div className="grid w-full max-w-4xl items-center gap-8 md:grid-cols-2">
            <div className="text-center text-white md:text-left">
              <img src="/logo.png" alt="ROMEO" className="mx-auto h-auto w-28 drop-shadow-lg sm:w-36 md:mx-0 md:w-44" />
              <h1 className="mt-4 text-2xl font-bold sm:text-3xl">ROMEO ພະນັກງານ</h1>
              <p className="mt-2 text-sm text-white/75 sm:text-base">ຖ່າຍຮູບຫຼັກຖານການເຂົ້າ-ອອກວຽກ ທຸກກະ ໄດ້ໃນບ່ອນດຽວ</p>
              <div className="mt-6 hidden gap-3 md:flex">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm">
                  <IonIcon icon={cameraOutline} /> ເປີດແອັບ ກ້ອງພ້ອມຖ່າຍ
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm">
                  <IonIcon icon={shieldCheckmarkOutline} /> ສະເພາະຂໍ້ມູນຂອງທ່ານ
                </span>
              </div>
            </div>

            <form
              className="mx-auto w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl sm:p-7"
              onSubmit={(e) => {
                e.preventDefault();
                void (mode === 'login' ? login() : setup());
              }}
            >
              <IonSegment value={mode} onIonChange={(e) => switchTo(e.detail.value as Mode)} className="mb-5">
                <IonSegmentButton value="login">
                  <IonLabel>ເຂົ້າສູ່ລະບົບ</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="setup">
                  <IonLabel>ຕັ້ງລະຫັດຜ່ານ</IonLabel>
                </IonSegmentButton>
              </IonSegment>

              {mode === 'setup' && (
                <p className="mb-4 rounded-2xl bg-wine-50 px-4 py-3 text-sm leading-relaxed text-wine-900">
                  ເທື່ອທຳອິດ ຫຼື ຫຼັງ HR ຣີເຊັດໃຫ້: ໃສ່ລະຫັດພະນັກງານ ແລະ ເບີໂທທີ່ໃຫ້ HR ໄວ້ ແລ້ວຕັ້ງລະຫັດຜ່ານຂອງທ່ານເອງ
                </p>
              )}

              <div className="space-y-3">
                <Field>
                  <IonInput
                    label="ລະຫັດພະນັກງານ"
                    labelPlacement="stacked"
                    inputmode="numeric"
                    autocomplete="username"
                    value={code}
                    onIonInput={(e) => setCode(String(e.detail.value ?? ''))}
                  />
                </Field>
                {mode === 'login' ? (
                  <Field>
                    <IonInput
                      label="ລະຫັດຜ່ານ"
                      labelPlacement="stacked"
                      type="password"
                      autocomplete="current-password"
                      value={password}
                      onIonInput={(e) => setPassword(String(e.detail.value ?? ''))}
                    >
                      <IonInputPasswordToggle slot="end" />
                    </IonInput>
                  </Field>
                ) : (
                  <>
                    <Field>
                      <IonInput
                        label="ເບີໂທ (ເບີທີ່ໃຫ້ HR ໄວ້)"
                        labelPlacement="stacked"
                        inputmode="tel"
                        autocomplete="tel"
                        placeholder="020 xxxx xxxx"
                        value={phone}
                        onIonInput={(e) => setPhone(String(e.detail.value ?? ''))}
                      />
                    </Field>
                    <Field>
                      <IonInput
                        label="ລະຫັດຜ່ານໃໝ່ (ຢ່າງໜ້ອຍ 6 ຕົວ)"
                        labelPlacement="stacked"
                        type="password"
                        autocomplete="new-password"
                        value={newPassword}
                        onIonInput={(e) => setNewPassword(String(e.detail.value ?? ''))}
                      >
                        <IonInputPasswordToggle slot="end" />
                      </IonInput>
                    </Field>
                    <Field>
                      <IonInput
                        label="ໃສ່ລະຫັດຜ່ານອີກຄັ້ງ"
                        labelPlacement="stacked"
                        type="password"
                        autocomplete="new-password"
                        value={confirm}
                        onIonInput={(e) => setConfirm(String(e.detail.value ?? ''))}
                      >
                        <IonInputPasswordToggle slot="end" />
                      </IonInput>
                    </Field>
                  </>
                )}
              </div>

              {error && (
                <div role="alert" className="mt-4 flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                  <IonIcon icon={alertCircle} className="mt-0.5 shrink-0 text-lg" />
                  <span>{error}</span>
                </div>
              )}

              <IonButton type="submit" expand="block" shape="round" className="mt-5 h-12 text-base font-semibold" disabled={busy}>
                {busy ? <IonSpinner name="crescent" /> : mode === 'login' ? 'ເຂົ້າສູ່ລະບົບ' : 'ຕັ້ງລະຫັດຜ່ານ ແລະ ເຂົ້າລະບົບ'}
              </IonButton>

              {mode === 'setup' && (
                <p className="mt-4 text-center text-xs text-stone-500">ເຄີຍຕັ້ງແລ້ວແຕ່ລືມ? ໃຫ້ HR ກົດຣີເຊັດໃຫ້ກ່ອນ ແລ້ວຈຶ່ງຕັ້ງໃໝ່ຢູ່ນີ້</p>
              )}
            </form>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};
