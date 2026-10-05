import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { loginInputSchema, type LoginInput } from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../lib/api';
import { FullPageLoader } from '../components/FullPageLoader';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/overview';
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { email: '', password: '' },
  });

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'authenticated') return <Navigate to={from} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login(values);
      navigate(from, { replace: true });
    } catch (err) {
      setServerError(
        err instanceof ApiError
          ? err.message
          : 'The server could not be reached. Check that the API is running, then try again.',
      );
    }
  });

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <div className="brand">
          <div className="brand-mark">
            <img src="/logo.png" alt="Grateful Solutions logo" />
          </div>
          <div className="brand-text">
            <div className="title">Grateful Solutions</div>
            <div className="subtitle">(Cambodia) Co., ltd</div>
          </div>
        </div>

        <h1 className={styles.heading}>Sign in</h1>
        <p className={styles.lede}>
          Logistics Command Center — shipping plans, customs, accounting and reporting.
        </p>

        {serverError && (
          <div className={styles.alert} role="alert">
            {serverError}
          </div>
        )}

        <form onSubmit={onSubmit} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              Work email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              className={styles.input}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
            {errors.email && (
              <span id="email-error" className={styles.fieldError}>
                {errors.email.message}
              </span>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className={styles.input}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
              {...register('password')}
            />
            {errors.password && (
              <span id="password-error" className={styles.fieldError}>
                {errors.password.message}
              </span>
            )}
          </div>

          <button
            type="submit"
            className={`new-shipment-btn ${styles.submit}`}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className={styles.footer}>
          Forgot your password? Ask an Admin to reset it in Staff &amp; Roles.
        </p>
      </div>
    </main>
  );
}
