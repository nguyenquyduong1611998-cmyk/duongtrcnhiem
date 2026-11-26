# Giai đoạn 7B — Xác minh Preview và bằng chứng sao lưu D1 (không VPS)

Ngày: 25/11/2026. Tiếp nối 7A/PR24 đã gộp Staging. Kiến trúc giữ nguyên:
**Cloudflare Pages + Functions + D1 + Firebase + PWA; KHÔNG VPS**.

**Phạm vi mã nguồn:** hai công cụ kiểm tra an toàn, kiểm thử offline và
quy trình người vận hành. Chưa truy cập Cloudflare Dashboard, chưa có backup
D1 thực tế, chưa chạy migration/restore, chưa thay binding, flags hay main.
CI xanh KHÔNG cho phép bật thi hoặc sử dụng dữ liệu thật.

## A. Kiểm tra trên Cloudflare Dashboard (người quản trị có quyền)

1. Workers & Pages → duongtrcnhiem-test → Deployments. Đối chiếu branch
   feature/staging-demo-quiz-pilot, commit SHA đang triển khai, hostname
   feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev, cấu hình build
   VITE_FIREBASE_ENV=staging. Không nhầm URL production, Pages test canonical
   hay bản deploy hash URL khác.
2. Settings → Variables & Bindings: xác nhận Preview có AUTH_DB_PREVIEW
   trỏ **đúng database ID** của duongtrcnhiem-auth-preview (không phải
   AUTH_DB/duongtrcnhiem-auth-staging). Không đưa ID, JWT, API key, secret,
   mật khẩu hoặc màn hình có thông tin nhạy cảm vào GitHub/chat.
3. Settings → General → Access policy: **Cloudflare Pages Preview mặc định
   có thể công khai** nếu chưa bật Access. Kiểm tra chính sách truy cập ở cả
   branch alias và các hashed Preview URL. Header noindex không bảo vệ
   thông tin khỏi người truy cập trực tiếp.
4. Tất cả cờ Phase6/7 vẫn OFF đến khi được duyệt. Nếu binding sai, Access
   không rõ hoặc chưa có deployment đúng SHA: **NO-GO**.

Tài liệu chính thức:
https://developers.cloudflare.com/pages/configuration/preview-deployments/
https://developers.cloudflare.com/d1/best-practices/import-export-data/
https://developers.cloudflare.com/d1/reference/time-travel/

## B. Quan sát HEAD không mang danh tính (tùy chọn)

Từ PowerShell trong thư mục repo đã tải về:

    # Mặc định KHÔNG kết nối mạng
    node .\scripts\phase7b-preview-surface-probe.mjs

    # Chỉ chạy khi chủ hệ thống cho phép kiểm tra HTTP công khai
    node .\scripts\phase7b-preview-surface-probe.mjs --allow-network

Chỉ gửi HEAD tới 7 path cố định trên đúng HTTPS Preview host. Không gửi
POST, cookie, Authorization, SQL, UID, body hoặc theo redirect. Mã 200,
302, 403, 404, 405 đều chỉ là **quan sát không kết luận được** việc
bật API, chính sách Access, D1, backup hoặc xác thực. Kết quả luôn
safeToEnableFeatures:false. Không đưa --allow-network vào CI.

## C. Sao lưu và đối chiếu file D1 SQL TRÊN MÁY RIÊNG

**Chưa thực hiện bước này.** Chỉ người quản trị có quyền, sau khi xác
nhận database ID và thời điểm an toàn, mới cân nhắc xuất backup:

    npx wrangler d1 info duongtrcnhiem-auth-preview
    npx wrangler d1 export duongtrcnhiem-auth-preview --remote --output="$env:USERPROFILE\Documents\d1-preview-evidence.sql"

Cloudflare lưu ý lệnh export có thể tạm chặn truy vấn khác. File xuất
có thể chứa UID, hash mật khẩu, đáp án, điểm. KHÔNG đưa file SQL vào
GitHub, chat, email không mã hóa hay drive công khai. Không chạy
wrangler d1 execute --remote và không bấm Time Travel Restore.

Sao chép file tới vị trí thứ hai được bảo vệ, rồi kiểm tra **cục bộ**:

    Copy-Item "$env:USERPROFILE\Documents\d1-preview-evidence.sql" "$env:USERPROFILE\Documents\d1-preview-copy.sql"
    node .\scripts\phase7b-backup-evidence.mjs "$env:USERPROFILE\Documents\d1-preview-evidence.sql" "$env:USERPROFILE\Documents\d1-preview-copy.sql"

Công cụ chỉ đọc hai file SQL riêng biệt, so sánh byte bằng SHA-256,
kiểm tra tĩnh profile Preview với scanner Phase4/5 đã có.
KHÔNG thực thi SQL, không gọi mạng, không in hash, đường dẫn hay dữ
liệu trong file. Chặn file symlink, quá 32 MiB, khác byte, bị sửa,
không có schema tối thiểu hoặc có câu lệnh đáng nghi.

OFFLINE_SQL_COPY_MATCH_ONLY chỉ nói rằng **hai bản sao file cục bộ
giống nhau và cấu trúc văn bản có vẻ đúng**; không chứng minh file
thật tới từ đúng D1, backup mới hoặc có thể khôi phục. Kết quả
cloudflareBackupVerified:false, isolatedRestoreVerified:false,
deploymentAllowed:false được giữ cố định.

Nếu có yêu cầu khôi phục, phải thực hiện trên **DB phụ cô lập** sau
phê duyệt riêng, kiểm tra integrity/FK, row counts và chức năng.
KHÔNG nhập backup vào database Preview đang hoạt động.

## D. Kịch bản kiểm thử nhiều thiết bị — CHƯA THỰC HIỆN

| Thiết bị | Tài khoản DEMO | Kiểm tra |
| --- | --- | --- |
| PC A | học viên A | Bắt đầu thi, nộp đúng một lần, điểm theo D1 |
| Điện thoại B | cùng học viên A | Mở lại, đọc lại điểm đã nộp; không tự POST lại |
| Trình duyệt C | học viên B | Không xem được điểm A |
| PC Admin | Google Admin staging | Xem thống kê, phân trang, không lộ đáp án |
| Thiết bị mất mạng | học viên A | Không nộp offline, không hiển thị điểm giả |
| PWA Android/iPhone/Windows | học viên A rồi B | Cài đặt, đăng xuất/chuyển tài khoản, không rò điểm qua cache |

Chỉ dùng tài khoản/đề toán giả, không quay hoặc gửi mật khẩu/token,
nội dung đơn vị hay dữ liệu thật. Ghi bằng chứng HTTP status, kết quả
đã ẩn định danh, thời gian theo máy chủ. Không đổi số điểm sau nộp.

## E. Kịch bản tải mạng 30–100 người — CHƯA THỰC HIỆN

Thử từng bậc 30 → 60 → 100 trên đúng Preview cô lập, khi có phép rõ
ràng và thống nhất thời lượng/tần suất. Đo độ trễ p50/p95/p99,
tỷ lệ lỗi, 401/403, retry và 409 nộp trùng, D1/Worker quotas,
rate limiting, chi phí và nhật ký tránh PII. Kết quả mô phỏng Node
SQLite 100 UID từ 6F không chứng minh chịu tải Internet.

## F. Cổng NO-GO

**Chưa xác minh:** commit Cloudflare đang deploy, D1 ID/binding thực,
Access policy cho mọi Preview URL, backup mới, restore phụ độc lập,
30–100 kết nối thật, đăng nhập A/B/Admin trên nhiều thiết bị, cài
PWA thiết bị thật và quyền xử lý dữ liệu. Do đó chưa được phép bật cờ,
chạy migration 6A–6D, đưa dữ liệu thật lên Internet hoặc thay Production.

Gộp PR25 khi CI đạt chỉ chuyển **mã nguồn thử nghiệm vào Staging**.
