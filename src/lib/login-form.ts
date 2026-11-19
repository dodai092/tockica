// Submit handling for every login form on the page (the header's sheet and the bike sheet's login step). One listener
// on `document`, so a form that a navigation replaces keeps working. A form carries its own error texts as
// data-error-* attributes, so the copy stays in the components.
import { login } from './login.ts';
import { signedIn } from './login-state.ts';

let bound = false;

const REASONS = {
  credentials: 'errorCredentials',
  'no-account': 'errorNoAccount',
  unavailable: 'errorUnavailable',
} as const;

export function bindLoginForms(): void {
  if (bound) return;
  bound = true;
  document.addEventListener('submit', async (e) => {
    const form = (e.target as Element).closest<HTMLFormElement>('form[data-login-form]');
    if (!form) return;
    e.preventDefault();
    if (form.dataset.busy) return;
    const error = form.querySelector<HTMLElement>('[data-login-error]')!;
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    error.textContent = '';
    form.dataset.busy = '1';
    submit.disabled = true;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim();
    const password = form.elements.namedItem('password') as HTMLInputElement;
    const result = await login(email, password.value);
    if (result.ok) {
      const user = await signedIn();
      password.value = '';
      if (!user) error.textContent = form.dataset.errorUnavailable ?? '';
    } else {
      error.textContent = form.dataset[REASONS[result.reason]] ?? '';
      if (result.reason === 'credentials') password.select();
    }
    delete form.dataset.busy;
    submit.disabled = false;
  });
}
