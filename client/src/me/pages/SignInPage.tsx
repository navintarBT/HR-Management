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

type Mode = 'login' | 'register';

// Same rule as the server (routes/auth.js): English letters and digits (plus
// . _ -), starting with a letter, so it never looks like an employee code.
const USERNAME_RULE = /^[a-z][a-z0-9._-]{2,29}$/;

const Field: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-1 transition focus-within:border-wine-600 focus-within:bg-white focus-within:ring-2 focus-within:ring-wine-100">
    {children}
  </div>
);

// Sign-in for the employees' app. "ລົງທະບຽນ" is both the first time and after
// HR resets a forgotten password: a username of their own, their employee code
// and a password — nothing else (server: routes/auth.js employee-register).
// They then sign in with the username or the employee code.
export const SignInPage: React.FC<{ onSignedIn: () => void }> = ({ onSignedIn }) => {
  const [mode, setMode] = useState<Mode>('login');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchTo = (next: Mode) => {
    setError(null);
    setMode(next);
  };

  const login = async () => {
    if (!loginId.trim() || !password) return setError('ກະລຸນາປ້ອນຊື່ຜູ້ໃຊ້ ຫຼື ລະຫັດພະນັກງານ ແລະ ລະຫັດຜ່ານ');
    setError(null);
    setBusy(true);
    try {
      const { data } = await meApi.post('/auth/login', { login: loginId.trim(), password });
      signIn(data.token, data.user);
      onSignedIn();
    } catch (err: any) {
      if (err?.response?.data?.needsSetup) {
        // Only an employee code gets here — carry it over to the form.
        if (/^\d+$/.test(loginId.trim())) setCode(loginId.trim());
        setMode('register');
        setError('ລະຫັດພະນັກງານນີ້ຍັງບໍ່ໄດ້ລົງທະບຽນ — ກະລຸນາລົງທະບຽນກ່ອນ');
      } else {
        setError(errorMessage(err, 'ເຂົ້າລະບົບບໍ່ສຳເລັດ — ກວດອິນເຕີເນັດແລ້ວລອງໃໝ່'));
      }
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    const name = username.trim().toLowerCase();
    if (!name || !code.trim() || !newPassword) return setError('ກະລຸນາປ້ອນຂໍ້ມູນໃຫ້ຄົບ');
    if (!USERNAME_RULE.test(name)) {
      return setError('ຊື່ຜູ້ໃຊ້ຕ້ອງເປັນຕົວອັກສອນອັງກິດ ຫຼື ຕົວເລກ 3–30 ໂຕ ຂຶ້ນຕົ້ນດ້ວຍຕົວອັກສອນ ແລະ ບໍ່ມີຍະຫວ່າງ — ຕົວຢ່າງ: somphone');
    }
    if (newPassword.length < 6) return setError('ລະຫັດຜ່ານຕ້ອງມີຢ່າງໜ້ອຍ 6 ຕົວ');
    setError(null);
    setBusy(true);
    try {
      const { data } = await meApi.post('/auth/employee-register', { username: name, employeeCode: code.trim(), password: newPassword });
      signIn(data.token, data.user);
      onSignedIn();
    } catch (err: any) {
      setError(errorMessage(err, 'ລົງທະບຽນບໍ່ສຳເລັດ — ກວດອິນເຕີເນັດແລ້ວລອງໃໝ່'));
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
                void (mode === 'login' ? login() : register());
              }}
            >
              <IonSegment value={mode} onIonChange={(e) => switchTo(e.detail.value as Mode)} className="mb-5">
                <IonSegmentButton value="login">
                  <IonLabel>ເຂົ້າສູ່ລະບົບ</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="register">
                  <IonLabel>ລົງທະບຽນ</IonLabel>
                </IonSegmentButton>
              </IonSegment>

              {mode === 'register' && (
                <p className="mb-4 rounded-2xl bg-wine-50 px-4 py-3 text-sm leading-relaxed text-wine-900">
                  ເທື່ອທຳອິດ ຫຼື ຫຼັງ HR ຣີເຊັດໃຫ້: ຕັ້ງຊື່ຜູ້ໃຊ້, ໃສ່ລະຫັດພະນັກງານ ແລະ ຕັ້ງລະຫັດຜ່ານຂອງທ່ານເອງ
                </p>
              )}

              <div className="space-y-3">
                {mode === 'login' ? (
                  <>
                    <Field>
                      <IonInput
                        label="ຊື່ຜູ້ໃຊ້ ຫຼື ລະຫັດພະນັກງານ"
                        labelPlacement="stacked"
                        autocomplete="username"
                        autocapitalize="off"
                        autocorrect="off"
                        spellcheck={false}
                        value={loginId}
                        onIonInput={(e) => setLoginId(String(e.detail.value ?? ''))}
                      />
                    </Field>
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
                  </>
                ) : (
                  <>
                    <Field>
                      <IonInput
                        label="ຊື່ຜູ້ໃຊ້ (ພາສາອັງກິດ)"
                        labelPlacement="stacked"
                        placeholder="ຕົວຢ່າງ: somphone"
                        autocomplete="username"
                        autocapitalize="off"
                        autocorrect="off"
                        spellcheck={false}
                        maxlength={30}
                        value={username}
                        onIonInput={(e) => setUsername(String(e.detail.value ?? '').toLowerCase())}
                      />
                    </Field>
                    <Field>
                      <IonInput
                        label="ລະຫັດພະນັກງານ"
                        labelPlacement="stacked"
                        inputmode="numeric"
                        autocomplete="off"
                        value={code}
                        onIonInput={(e) => setCode(String(e.detail.value ?? ''))}
                      />
                    </Field>
                    <Field>
                      <IonInput
                        label="ລະຫັດຜ່ານ (ຢ່າງໜ້ອຍ 6 ຕົວ)"
                        labelPlacement="stacked"
                        type="password"
                        autocomplete="new-password"
                        value={newPassword}
                        onIonInput={(e) => setNewPassword(String(e.detail.value ?? ''))}
                      >
                        <IonInputPasswordToggle slot="end" />
                      </IonInput>
                    </Field>
                    {/* Admins can read it back (server: utils/passwordView.js) — say so. */}
                    <p className="register-password-note px-1 text-xs leading-relaxed text-stone-500">
                      HR ເບິ່ງລະຫັດຜ່ານນີ້ໄດ້ ເພື່ອຊ່ວຍເວລາທ່ານລືມ — ຢ່າໃຊ້ລະຫັດດຽວກັບ Facebook ຫຼື ທະນາຄານ
                    </p>
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
                {busy ? <IonSpinner name="crescent" /> : mode === 'login' ? 'ເຂົ້າສູ່ລະບົບ' : 'ລົງທະບຽນ ແລະ ເຂົ້າລະບົບ'}
              </IonButton>

              {mode === 'login' ? (
                <p className="mt-4 text-center text-sm text-stone-500">
                  ເທື່ອທຳອິດ?{' '}
                  <button type="button" className="font-semibold text-wine-700 underline" onClick={() => switchTo('register')}>
                    ລົງທະບຽນ
                  </button>
                </p>
              ) : (
                <p className="mt-4 text-center text-xs text-stone-500">ເຄີຍລົງທະບຽນແລ້ວແຕ່ລືມລະຫັດຜ່ານ? ໃຫ້ HR ກົດຣີເຊັດໃຫ້ກ່ອນ ແລ້ວຈຶ່ງລົງທະບຽນໃໝ່ຢູ່ນີ້</p>
              )}
            </form>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};
