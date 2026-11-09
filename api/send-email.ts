import type { IncomingMessage, ServerResponse } from 'http';
import nodemailer from 'nodemailer';

interface ExtendedRequest extends IncomingMessage {
  body?: any;
}

interface ExtendedResponse extends ServerResponse {
  status: (statusCode: number) => ExtendedResponse;
  json: (data: any) => void;
}

export default async function handler(req: ExtendedRequest, res: ExtendedResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, message: 'Method Not Allowed' }));
    return;
  }

  try {
    let bodyData = req.body;
    if (!bodyData && typeof req.read === 'function') {
      const buffers = [];
      for await (const chunk of req) {
        buffers.push(chunk);
      }
      const rawString = Buffer.concat(buffers).toString();
      try {
        bodyData = JSON.parse(rawString);
      } catch {
        bodyData = {};
      }
    }

    const {
      to,
      subject,
      body,
      html,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpFrom,
    } = bodyData || {};

    if (!to || !subject || (!body && !html)) {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 400;
      res.end(JSON.stringify({
        success: false,
        message: 'Thiếu thông tin bắt buộc: "to", "subject" và "body/html"',
      }));
      return;
    }

    const host = process.env.SMTP_HOST || smtpHost || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT || smtpPort || 587);
    const user = (process.env.SMTP_USER || smtpUser || '').trim();
    // MẬT KHẨU DUY NHẤT TỪ BIẾN MÔI TRƯỜNG VERCEL (Không nhận từ client để tránh xung đột)
    const rawPass = (process.env.SMTP_PASS || '').trim();
    const pass = rawPass.replace(/\s+/g, '');
    const from = process.env.SMTP_FROM || smtpFrom || user || 'FSCCT Booking <noreply@fpt.edu.vn>';

    if (user && pass) {
      try {
        const transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
          tls: { rejectUnauthorized: false },
        });

        const mailOptions = {
          from: from.includes('<') ? from : `FSCCT Booking <${from}>`,
          to,
          subject,
          text: body || '',
          html: html || (body ? body.replace(/\n/g, '<br>') : ''),
        };

        const info = await transporter.sendMail(mailOptions);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({
          success: true,
          method: 'smtp',
          message: `Đã gửi email trực tiếp qua SMTP (${user}) tới: ${to}`,
          messageId: info.messageId,
        }));
        return;
      } catch (smtpErr: any) {
        const errDetail = smtpErr?.message ? String(smtpErr.message) : '';
        const is535 = errDetail.includes('535') || errDetail.toLowerCase().includes('username and password not accepted');
        const helpfulMsg = is535
          ? `Lỗi 535: Mật khẩu ứng dụng Gmail (App Password 16 ký tự) chưa đúng hoặc đã bị Google thu hồi. Vui lòng tạo lại App Password tại myaccount.google.com`
          : `Lỗi kết nối máy chủ SMTP: ${errDetail}`;

        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({
          success: false,
          method: 'smtp_error',
          message: helpfulMsg,
        }));
        return;
      }
    }

    // Fallback Ethereal test account if credentials are not provided
    const testAccount = await nodemailer.createTestAccount();
    const testTransporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });

    const testInfo = await testTransporter.sendMail({
      from: `FSCCT Booking <${testAccount.user}>`,
      to,
      subject,
      text: body || '',
      html: html || (body ? body.replace(/\n/g, '<br>') : ''),
    });

    const previewUrl = nodemailer.getTestMessageUrl(testInfo);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({
      success: true,
      method: 'ethereal_test',
      usedTestAccount: true,
      message: 'Đã tạo email thử nghiệm. Vui lòng nhập SMTP_USER và SMTP_PASS trong biến môi trường Vercel hoặc Cài đặt web để gửi thật.',
      previewUrl: previewUrl || undefined,
    }));
  } catch (error: any) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 500;
    res.end(JSON.stringify({
      success: false,
      message: error?.message || 'Lỗi xử lý gửi email',
    }));
  }
}
