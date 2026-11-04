import { Injectable, InternalServerErrorException } from '@nestjs/common';
import nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  async sendVerificationCode(to: string, code: string) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) throw new InternalServerErrorException('Email delivery is not configured');
    const transport = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT), secure: Number(SMTP_PORT) === 465, auth: { user: SMTP_USER, pass: SMTP_PASSWORD } });
    try {
      await transport.sendMail({ from: SMTP_FROM, to, subject: 'Your SafeCheck verification code', text: `Your SafeCheck verification code is ${code}. It expires in 10 minutes. Never share this code with anyone.`, html: `<div style="font-family:Arial,sans-serif;color:#15202b"><h2>Verify your SafeCheck email</h2><p>Use this code to finish creating your account:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. SafeCheck will never ask you to share it.</p></div>` });
    } catch { throw new InternalServerErrorException('We could not send the verification email. Please try again shortly.'); }
  }
}
