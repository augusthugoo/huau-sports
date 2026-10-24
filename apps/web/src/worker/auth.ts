import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createDb } from "@huau/db";
import * as schema from "@huau/db/schema";
import { sendTransactionalEmail } from "./email";

export function createAuth(env: Env) {
  const db = createDb(env.HUAU_DB);
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendTransactionalEmail(env, {
          to: user.email,
          toName: user.name,
          subject: "Confirmá tu email en HUAU",
          eyebrow: "HUAU · CUENTA",
          heading: "Confirmá tu email",
          body: "Creaste una cuenta en HUAU. Confirmá este correo para activar el acceso y continuar con tu perfil e inscripciones.",
          actionLabel: "Confirmar email",
          actionUrl: url,
          footer: "El enlace vence en 24 horas. Si no creaste esta cuenta, podés ignorar este correo.",
          tag: "huau-email-verification",
        });
      },
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      afterEmailVerification: async (user) => {
        const parts = user.name.trim().split(/\s+/).filter(Boolean);
        const stamp = new Date();
        await db.insert(schema.userProfiles).values({
          userId: user.id,
          firstName: parts[0] || "Jugador",
          lastName: parts.slice(1).join(" "),
          preferredLocale: "es-UY",
          createdAt: stamp,
          updatedAt: stamp,
        }).onConflictDoNothing({ target: schema.userProfiles.userId });
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await sendTransactionalEmail(env, {
          to: user.email,
          toName: user.name,
          subject: "Recuperá tu contraseña de HUAU",
          eyebrow: "HUAU · SEGURIDAD",
          heading: "Restablecé tu contraseña",
          body: "Recibimos una solicitud para cambiar la contraseña de tu cuenta HUAU.",
          actionLabel: "Crear nueva contraseña",
          actionUrl: url,
          footer: "El enlace vence en 1 hora. Si no pediste este cambio, podés ignorar este correo.",
          tag: "huau-password-reset",
        });
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-up/email": { window: 300, max: 5 },
        "/send-verification-email": { window: 300, max: 3 },
        "/request-password-reset": { window: 300, max: 3 },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      useSecureCookies: env.APP_ENV !== "development",
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    trustedOrigins: [
      env.BETTER_AUTH_URL,
      "https://*-huau-sports-staging.augusthugoo.workers.dev",
    ],
  });
}

export type HuauAuth = ReturnType<typeof createAuth>;
