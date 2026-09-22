import { Resend } from "resend";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const resend = new Resend(env.resendApiKey);

async function safeSend(params: {
  to: string;
  subject: string;
  html: string;
}) {
  try {
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
    subject: "Pagamento confermato - Auralis SkyShare",
    html: `
      <h2>Ciao ${params.bookerFirstName},</h2>
      <p>Il tuo pagamento è stato confermato per il volo <strong>${params.fromAirport} → ${params.toAirport}</strong>.</p>
      <p>Ti aspettiamo a bordo!</p>
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
    subject: "Nuova prenotazione confermata",
    html: `
      <h2>Nuova prenotazione</h2>
      <p>Volo <strong>${params.fromAirport} → ${params.toAirport}</strong> prenotato da ${params.bookerFirstName} ${params.bookerLastName}.</p>
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