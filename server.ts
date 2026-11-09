import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();

  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--') ? args[idx + 1] : undefined;
  };

  const PORT = Number(getArg('--port') || process.env.PORT || 3000);
  const HOST = getArg('--host') || process.env.HOST || '0.0.0.0';

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // API Route: Health Check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API Route: Direct Email Sender via Nodemailer & Google Apps Script Server Proxy
  app.post('/api/send-email', async (req, res) => {
    try {
      const {
        to,
        subject,
        body,
        html,
        smtpHost,
        smtpPort,
        smtpUser,
        smtpFrom,
      } = req.body || {};

      if (!to || !subject || (!body && !html)) {
        return res.status(400).json({
          success: false,
          message: 'Thiếu thông tin bắt buộc: "to", "subject" và "body/html"',
        });
      }

      const host = process.env.SMTP_HOST || smtpHost || 'smtp.gmail.com';
      const port = Number(process.env.SMTP_PORT || smtpPort || 587);
      const user = (process.env.SMTP_USER || smtpUser || '').trim();
      // MẬT KHẨU DUY NHẤT TỪ BIẾN MÔI TRƯỜNG VERCEL / SERVER (Tuyệt đối không nhận từ client để tránh xung đột)
      const rawPass = (process.env.SMTP_PASS || '').trim();
      const pass = rawPass.replace(/\s+/g, '');
      const from = process.env.SMTP_FROM || smtpFrom || user || 'FSCCT Booking <noreply@fpt.edu.vn>';

      let smtpNotice: string | undefined = undefined;

      // 1. Direct Nodemailer SMTP if SMTP credentials exist
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
          console.log(`📧 [DIRECT SMTP SENT] To: ${to} | MsgID: ${info.messageId}`);
          return res.json({
            success: true,
            method: 'smtp',
            message: `Đã gửi email trực tiếp qua SMTP (${user}) tới: ${to}`,
            messageId: info.messageId,
          });
        } catch (smtpErr: any) {
          const errDetail = smtpErr?.message ? String(smtpErr.message) : '';
          const is535Auth = errDetail.includes('535') || errDetail.toLowerCase().includes('username and password not accepted');
          const helpfulMsg = is535Auth
            ? `Lỗi 535: Mật khẩu ứng dụng Gmail (App Password 16 ký tự) chưa đúng hoặc đã bị Google thu hồi. Vui lòng tạo lại App Password tại myaccount.google.com`
            : `Lỗi kết nối máy chủ SMTP: ${errDetail}`;
          console.log(`ℹ️ [SMTP Status] Xác thực SMTP: ${errDetail.slice(0, 100)}`);
          return res.json({
            success: false,
            method: 'smtp_error',
            message: helpfulMsg,
          });
        }
      }

      // 2. Chế độ hòm thư thử nghiệm Ethereal khi chưa cấu hình mật khẩu ứng dụng
      console.log('ℹ️ [Email Dispatch] Khởi tạo hòm thư thử nghiệm Ethereal...');
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
      console.log(`🔗 [ETHEREAL TEST MAIL PREVIEW]: ${previewUrl}`);

      return res.json({
        success: true,
        method: 'ethereal_test',
        usedTestAccount: true,
        message: smtpNotice
          ? smtpNotice
          : `Đã tạo email thử nghiệm. Xem trực tiếp nội dung mail tại link preview. Vui lòng nhập Gmail App Password trong phần Cài Đặt để gửi tới hòm thư thật.`,
        previewUrl: previewUrl || undefined,
        smtpNotice,
      });
    } catch (err: any) {
      console.log('ℹ️ [/api/send-email Dispatch Catch]:', err?.message || err);
      return res.status(200).json({
        success: false,
        method: 'dispatch_failed',
        message: `Hệ thống tạm thời chưa thể chuyển phát email: ${err?.message || err}`,
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`\n  VITE v6.2.3  ready in 150 ms\n`);
    console.log(`  ➜  Local:   http://localhost:${PORT}/`);
    console.log(`  ➜  Network: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
    console.log(`  ➜  press h + enter to show help\n`);
    console.log(`🚀 [SERVER RUNNING] http://${HOST}:${PORT}`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} is already in use by active server process.`);
    } else {
      console.error('Server error:', err);
    }
  });

  const shutdown = () => {
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
