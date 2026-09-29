import { Resend } from "resend";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const resend = new Resend(env.resendApiKey);
const SITE_URL = "https://auralisair.it";
const LOGO_URL = `${SITE_URL}/auralis-logo.png`;
const HERO_URL = `${SITE_URL}/assets/jet_door_opening.jpg`;

async function safeSend(params: {
  to: string;
  subject: string;
  html: string;
}) {
  try {
    if (!env.resendApiKey || !env.emailFrom) {
      logger.warn("Resend non configurato: email non inviata");
      return;
    }
    await resend.emails.send({
      from: env.emailFrom,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    logger.info({ to: params.to, subject: params.subject }, "Email inviata");
  } catch (err) {
    // Regola della FASE 8: un errore email non deve mai rompere il flusso principale
    logger.error({ err, to: params.to }, "Invio email fallito, continuo comunque");
  }
}

function newsletterShell(params: {
  preheader: string;
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote: string;
  unsubscribeUrl?: string;
}) {
  const cta = params.ctaLabel && params.ctaUrl
    ? `
      <tr>
        <td style="padding:8px 42px 34px 42px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="border-radius:999px;background:#e8c96a;">
                <a href="${params.ctaUrl}" style="display:inline-block;padding:15px 26px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#0a1628;text-decoration:none;border-radius:999px;">${params.ctaLabel}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : "";

  const unsubscribe = params.unsubscribeUrl
    ? `<div style="margin-top:12px;"><a href="${params.unsubscribeUrl}" style="color:#8190a3;text-decoration:underline;">Annulla iscrizione</a></div>`
    : "";

  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>${params.title}</title>
</head>
<body style="margin:0;padding:0;background:#f3f5f8;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${params.preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f5f8;margin:0;padding:0;">
    <tr>
      <td align="center" style="padding:34px 14px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:26px;overflow:hidden;box-shadow:0 18px 55px rgba(10,22,40,.10);">
          <tr>
            <td style="background:#0a1628;padding:24px 34px;text-align:left;">
              <a href="${SITE_URL}" style="text-decoration:none;display:inline-block;">
                <img src="${LOGO_URL}" width="150" alt="Auralis" style="display:block;width:150px;max-width:100%;height:auto;border:0;">
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0;">
              <img src="${HERO_URL}" width="640" alt="Auralis" style="display:block;width:100%;height:auto;max-height:260px;object-fit:cover;border:0;">
            </td>
          </tr>
          <tr>
            <td style="padding:38px 42px 8px 42px;font-family:Arial,Helvetica,sans-serif;">
              <div style="font-size:10px;line-height:1.4;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;color:#b38e2e;margin-bottom:13px;">${params.eyebrow}</div>
              <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:34px;line-height:1.08;letter-spacing:-1.2px;color:#0a1628;font-weight:800;">${params.title}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 42px 22px 42px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.72;color:#536274;">${params.body}</td>
          </tr>
          ${cta}
          <tr>
            <td style="padding:24px 42px 32px 42px;border-top:1px solid #e8edf2;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#8190a3;">
              ${params.footerNote}
              ${unsubscribe}
              <div style="margin-top:14px;">Auralis SkyShare · <a href="${SITE_URL}" style="color:#536274;text-decoration:none;">auralisair.it</a></div>
            </td>
          </tr>
        </table>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.5;color:#9aa5b3;padding:16px 10px 0;">© 2026 Auralis SkyShare</div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendNewsletterConfirmationEmail(params: {
  to: string;
  confirmationUrl: string;
}) {
  await safeSend({
    to: params.to,
    subject: "Conferma la tua iscrizione ad Auralis",
    html: newsletterShell({
      preheader: "Conferma il tuo indirizzo per completare l'iscrizione ad Auralis.",
      eyebrow: "Auralis Updates",
      title: "Ancora un passo.",
      body: `
        <p style="margin:0 0 14px 0;">Conferma il tuo indirizzo per ricevere rotte selezionate, nuovi Empty Leg e aggiornamenti Auralis.</p>
        <p style="margin:0;">Il link di conferma rimane valido per 48 ore.</p>`,
      ctaLabel: "Conferma iscrizione",
      ctaUrl: params.confirmationUrl,
      footerNote: "Se non hai richiesto questa iscrizione, puoi semplicemente ignorare questa email.",
    }),
  });
}

export async function sendNewsletterWelcomeEmail(params: { to: string; unsubscribeUrl: string }) {
  await safeSend({
    to: params.to,
    subject: "Benvenuta/o nel Journal Auralis",
    html: newsletterShell({
      preheader: "Iscrizione confermata. Benvenuta/o nel Journal Auralis.",
      eyebrow: "Journal Auralis",
      title: "Iscrizione confermata.",
      body: `
        <p style="margin:0 0 14px 0;">Da oggi riceverai una selezione di aggiornamenti Auralis: nuove rotte, disponibilità Empty Leg e storie dal Journal.</p>
        <p style="margin:0;">Poche comunicazioni, scelte con cura. Grazie per essere con noi.</p>`,
      ctaLabel: "Scopri il Journal",
      ctaUrl: `${SITE_URL}/journal/`,
      footerNote: "Ricevi questa email perché hai confermato volontariamente l'iscrizione agli aggiornamenti Auralis.",
      unsubscribeUrl: params.unsubscribeUrl,
    }),
  });
}

export async function sendBookingCreatedEmail(params: {
  to: string;
  bookerFirstName: string;
  fromAirport: string;
  toAirport: string;
  totalAmount: string;
  currency: string;
}) {
  await safeSend({
    to: params.to,
    subject: "Prenotazione ricevuta - Auralis SkyShare",
    html: `
      <h2>Ciao ${params.bookerFirstName},</h2>
      <p>Abbiamo ricevuto la tua richiesta di prenotazione per il volo <strong>${params.fromAirport} → ${params.toAirport}</strong>.</p>
      <p>Totale: <strong>${params.totalAmount} ${params.currency}</strong></p>
      <p>Completa il pagamento per confermare la prenotazione.</p>
    `,
  });
}

export async function sendSplitPaymentShareEmail(params: {
  to: string;
  firstName: string;
  bookerFirstName: string;
  fromAirport: string;
  toAirport: string;
  amount: string;
  currency: string;
  checkoutUrl: string;
  expiresAt: Date;
}) {
  const deadline = params.expiresAt.toLocaleString("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  await safeSend({
    to: params.to,
    subject: "La tua quota di volo ti aspetta - Auralis SkyShare",
    html: `
      <h2>Ciao ${params.firstName},</h2>
      <p>${params.bookerFirstName} ti ha incluso in una prenotazione condivisa per il volo <strong>${params.fromAirport} → ${params.toAirport}</strong>.</p>
      <p>La tua quota è di <strong>${params.amount} ${params.currency}</strong>.</p>
      <p><a href="${params.checkoutUrl}">Paga la tua quota</a></p>
      <p>Completa il pagamento entro il <strong>${deadline}</strong>: se anche solo una quota non viene pagata in tempo, l'intera prenotazione viene annullata e chi ha già pagato viene rimborsato automaticamente.</p>
    `,
  });
}

export async function sendPaymentConfirmedEmail(params: {
  to: string;
  bookerFirstName: string;
  fromAirport: string;
  toAirport: string;
}) {
  await safeSend({
    to: params.to,
    subject: "Pagamento completato - Auralis SkyShare",
    html: `
      <h2>Ciao ${params.bookerFirstName},</h2>
      <p>Il pagamento per il volo <strong>${params.fromAirport} → ${params.toAirport}</strong> è stato completato.</p>
      <p>La prenotazione è ora in attesa della conferma operativa dell'operatore. Ti invieremo una nuova email appena il volo sarà confermato.</p>
    `,
  });
}

export async function sendBookingConfirmedEmail(params: {
  to: string;
  bookerFirstName: string;
  fromAirport: string;
  toAirport: string;
}) {
  await safeSend({
    to: params.to,
    subject: "Volo confermato - Auralis SkyShare",
    html: `
      <h2>Ciao ${params.bookerFirstName},</h2>
      <p>Il volo <strong>${params.fromAirport} → ${params.toAirport}</strong> è stato confermato dall'operatore.</p>
      <p>Riceverai le informazioni operative necessarie prima della partenza.</p>
    `,
  });
}

export async function sendRefundIssuedEmail(params: {
  to: string;
  fromAirport: string;
  toAirport: string;
}) {
  await safeSend({
    to: params.to,
    subject: "Rimborso avviato - Auralis SkyShare",
    html: `
      <h2>Rimborso avviato</h2>
      <p>La prenotazione per il volo <strong>${params.fromAirport} → ${params.toAirport}</strong> non è stata confermata o è stata annullata.</p>
      <p>Abbiamo avviato il rimborso della quota pagata sul metodo di pagamento originale. I tempi di accredito dipendono dall'istituto di pagamento.</p>
    `,
  });
}

export async function sendOperatorBookingNotification(params: {
  to: string;
  fromAirport: string;
  toAirport: string;
  bookerFirstName: string;
  bookerLastName: string;
}) {
  await safeSend({
    to: params.to,
    subject: "Pagamenti completati - nuova prenotazione",
    html: `
      <h2>Prenotazione pronta per la conferma</h2>
      <p>Per il volo <strong>${params.fromAirport} → ${params.toAirport}</strong> di ${params.bookerFirstName} ${params.bookerLastName} risultano completati i pagamenti previsti.</p>
      <p>Il team Auralis ti contatterà per la conferma operativa della tratta.</p>
    `,
  });
}

export async function sendAdminContactRequestNotification(params: {
  name: string;
  email: string;
  topic: string;
  message: string;
}) {
  await safeSend({
    to: env.adminEmail,
    subject: `Nuova richiesta di contatto: ${params.topic}`,
    html: `
      <h2>Richiesta da ${params.name} (${params.email})</h2>
      <p>Argomento: ${params.topic}</p>
      <p>${params.message}</p>
    `,
  });
}

export async function sendOperatorApprovedEmail(params: { to: string; companyName: string }) {
  await safeSend({
    to: params.to,
    subject: "Il tuo profilo operatore è stato approvato",
    html: `<h2>Congratulazioni!</h2><p>${params.companyName} è stato approvato come operatore su Auralis SkyShare.</p>`,
  });
}

export async function sendOperatorRejectedEmail(params: { to: string; companyName: string }) {
  await safeSend({
    to: params.to,
    subject: "Aggiornamento sulla tua richiesta operatore",
    html: `<h2>Richiesta non approvata</h2><p>${params.companyName} non è stato approvato in questo momento.</p>`,
  });
}

export async function sendAdminNewOperatorNotification(params: {
  companyName: string;
  contactEmail: string;
  userEmail: string;
}) {
  await safeSend({
    to: env.adminEmail,
    subject: `Nuova richiesta operatore: ${params.companyName}`,
    html: `
      <h2>Nuova candidatura operatore</h2>
      <p><strong>${params.companyName}</strong> ha richiesto l'accesso come operatore su Auralis SkyShare.</p>
      <p>Email di contatto: ${params.contactEmail}</p>
      <p>Account utente: ${params.userEmail}</p>
      <p>Vai alla Dashboard Admin per approvare o rifiutare la richiesta.</p>
    `,
  });
}
