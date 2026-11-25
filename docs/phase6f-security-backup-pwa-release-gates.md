# Phase 6F — cổng nghiệm thu trước vận hành (KHÔNG VPS)

Ngày: 25/11/2026. Cơ sở: `feature/staging-demo-quiz-pilot` sau
PR22 Phase 6E đã gộp. Branch 6F riêng, PR dự kiến #23.
**Kiến trúc bắt buộc: Cloudflare Pages + Functions + D1 + Firebase + PWA.
KHÔNG dùng VPS, IP tĩnh hoặc backend máy chủ riêng.**

## Trạng thái phải báo cáo đúng

| Hạng mục | Đã chứng minh | Chưa chứng minh |
| --- | --- | --- |
| Phase 6A–6E mã nguồn | Tests + GitHub Actions ở nhánh Staging | Hoạt động trên D1 thật |
| SQLite backup/restore | Tạo file snapshot SQLite giả, copy sang nơi thử, phục hồi 100 submission DEMO | Tính mới của backup D1 Preview, Cloudflare export/import thật |
| Thử 100 học viên | 100 UID giả, gọi bất đồng bộ API server và đọc điểm trong một tiến trình Node/SQLite | 100 người thật, độ trễ p95/p99, sự cố mạng, D1/Worker quotas, nhiều thiết bị |
| Đăng nhập/quyền | JWT RSA thử nghiệm và các test chặn A/B/Admin, flag mặc định OFF | Phân quyền thật được phê duyệt, thực tế 100 tài khoản |
| PWA | Manifest SVG + SW chỉ cache asset bất biến và chỉ đăng ký trên host Preview có cờ | Cài được trên Android/iOS/Windows thật, tương thích icon PNG, HTTPS/browser ở thiết bị |
| Production | Chưa thay đổi `main`, không cần VPS | Chưa được phép đưa tính năng ra sử dụng thật |

`scripts/phase6f-ci-readiness-report.mjs` **luôn đặt
`deploymentAllowed:false`** bất kể CI xanh hay không.
Đây là dấu chặn có chủ ý: các bước nghiệm thu thực tế phải có
bằng chứng từ người vận hành được ủy quyền, không thể tự khai báo trong
mã nguồn hay bằng flag trình duyệt.

## 1. PWA trên đúng Preview (chỉ DEMO)

6F thêm các file `public/phase6f-preview.webmanifest`,
`public/phase6f-preview-icon.svg`,
`public/phase6f-preview-sw.js`,
`src/utils/phase6fPreviewPwa.ts`. Chỉ khi:

- build có `VITE_PHASE6F_PWA_PREVIEW_UI=true`,
- `VITE_FIREBASE_ENV=staging`,
- HTTPS và hostname **chính xác**
  `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`,
- trình duyệt hỗ trợ `navigator.serviceWorker`,

mới thêm manifest link và đăng ký SW ở `/phase6f-preview-sw.js`.
Mặc định OFF. **Không** tự bật trên `main`, GitHub Pages, Cloudflare
production hoặc hostname khác.

SW **chỉ cache** public static Vite `/assets/*-[hash].js|css|images|fonts`
nếu response không đánh dấu `private/no-store`. Đặc biệt **không
intercept/cache**: mọi `/api/*`, request có Authorization/Cookie,
POST/PUT, navigation HTML, Firebase endpoint, scores, tokens, question
answers, subscriptions hay D1 rows. Không sinh HTML fallback offline.
**Không thể nộp thi offline**, thời hạn nộp vẫn hoàn toàn do D1 kiểm tra.

Biểu tượng hiện là SVG. Một số hệ điều hành/trình duyệt yêu cầu icon PNG
192x192/512x512 và thao tác cài đặt thủ công để xác nhận. Đến khi test
trên thiết bị thật và hoàn thiện icon/UX nếu cần, **không tuyên bố
PWA đã đạt nghiệm thu cài đặt**.

## 2. Offline backup / restore / 100 students

Chạy:

```sh
node --test tests/phase6f-offline-recovery-100students.test.mjs
node --test tests/phase6f-pwa-sw-security.test.mjs
bun test tests/phase6f-pwa-browser.test.ts
node scripts/phase6f-ci-readiness-report.mjs
bun run lint
bun run build
```

Bài thử tạo SQLite giả trong thư mục tạm, thêm bảng base + Phase4/5
và 100 tài khoản DEMO giả; VACUUM INTO tạo snapshot; sao chép sang
file phục hồi **khác**, rồi thử áp dụng lần lượt 6B, 6C, 6A, 6D.
Hệ thống xuất bản một đề toán giả, bắt đầu và ghi điểm cho 100 UID,
đọc lại lịch sử từng UID và 4 trang Admin, kiểm tra 50 lượt 10 điểm +
50 lượt 0 điểm, integrity, foreign keys, trigger chống sửa điểm,
không thay đổi Phase4/5; tạo thêm bản sao hậu kỳ để thử restore kết quả.

Toàn bộ chạy **SQLite trên GitHub runner**, không có API hoặc
thao tác Cloudflare D1, không có dữ liệu quân nhân/đề thật.
`Promise.all` ở đây không mô phỏng độ trễ/băng thông/hạn mức D1 thật.
Không dùng kết quả đó để khẳng định đã chịu tải 100 người trên Internet.

## 3. GO / NO-GO trước khi dùng thử trên D1 Preview

Các mục sau **CHƯA ĐƯỢC THỰC HIỆN**, cần cấp phép riêng; không gộp PR
hoặc CI xanh nào tự động thực hiện:

1. Xác nhận chính xác **tên/ID D1 Preview** `duongtrcnhiem-auth-preview`
   gắn binding `AUTH_DB_PREVIEW`, độc lập mọi D1 Production và
   `duongtrcnhiem-auth-staging`. Đối chiếu DB ID từ Cloudflare Dashboard,
   không tin mỗi biến tên. Dùng tài khoản vận hành được ủy quyền.
2. **Backup D1 Preview MỚI** sau các bài Phase5; lưu riêng an toàn và
   **thử khôi phục trên DB thứ hai tách biệt**, kiểm tra row counts,
   integrity/foreign keys hoặc phép kiểm tương đương, thời gian khôi phục.
   Không upload backup hay dữ liệu của đơn vị vào GitHub, chat hoặc CI.
3. Duyệt từng migration additive 6B → 6C → 6A → 6D cùng các prerequisites
   Phase4/5. Review SQL/triggers, hành vi rollback, re-run, phiên submit
   trùng, race và backup. Áp dụng chỉ sau phê duyệt riêng của chủ DB;
   **không chạy các file `-draft.sql` ngay bây giờ**.
4. Bật lần lượt các cờ DEMO mặc định OFF, chỉ trên hostname Preview
   pin sẵn; kiểm thử hoàn chỉnh signed Google Admin, student A/B,
   anonymous, locked account, stale JWT, sai host, mất mạng khi nộp,
   đồng hồ trên thiết bị bị chỉnh và offline, nhập vượt giới hạn.
5. Kiểm thử **30 → 60 → 100 kết nối thực tế** theo kịch bản được phê duyệt
   bằng dữ liệu giả, trên chính Cloudflare Pages/D1 Preview cô lập.
   Ghi nhận request success/error, retry/duplicate, p50/p95/p99, D1
   requests/rows/quotas, chi phí, thời gian phát token và xung đột;
   thống nhất tiêu chuẩn chấp nhận trước, không tự chế số đo.
6. Kiểm thử PWA trên điện thoại Android/iPhone và máy Windows: cài đặt,
   cập nhật SW, mở app sau đóng trình duyệt, mất mạng, đăng xuất,
   đổi tài khoản A/B, không xuất hiện điểm/câu trả lời cũ từ cache.
   Bổ sung PNG icon phù hợp thiết bị nếu cần.
7. Rà soát repo **đang Public**, bảo mật cấu hình, phân loại dữ liệu,
   quyền truy cập Internet, bảo vệ tài khoản, Cloudflare Rate Limiting,
   khóa tài khoản, nhật ký không chứa PII, giám sát D1,
   phương án phục hồi và quản trị nội dung. Chỉ người có thẩm quyền
   mới phê duyệt dữ liệu thật đưa lên các dịch vụ này.

Nếu thiếu **bất kỳ** bằng chứng nào phía trên: **NO-GO** cho thi thật.
Chỉ khi tất cả đã được rà soát, nghiệm thu và có phê duyệt mới đề xuất
một bước bật vận hành **tách riêng**, vẫn không VPS.

## 4. Phạm vi PR 6F

6F chỉ thêm PWA Preview mặc định OFF, bộ kiểm thử/tiêu chí bảo mật,
mô phỏng restore và báo cáo chặn triển khai. Không thay đổi bảng điểm
hiện tại, không bật flag Cloudflare, không chạy D1 migration, không
đẩy bí mật lên GitHub, không chạm `main`.

Khi CI xanh: chỉ đủ điều kiện xem xét **gộp mã nguồn vào nhánh Staging**,
KHÔNG đồng nghĩa đã hoàn tất nghiệm thu vận hành.
