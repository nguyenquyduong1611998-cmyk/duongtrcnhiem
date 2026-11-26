# Giai đoạn 7E — đồng bộ bài thi/điểm giữa nhiều thiết bị (không VPS)

Ngày: 26/11/2026. Cơ sở: PR27/Phase7D đã gộp vào Staging.
Kiến trúc giữ nguyên **Cloudflare Pages + Functions + D1 + Firebase
Authentication + PWA**. KHÔNG dùng VPS, IP tĩnh hay backend riêng.

## Kết quả Phase7E: chỉ kiểm thử offline, CHƯA nghiệm thu Internet thật

Các API Phase6D/6E đã có khả năng nộp/chấm điểm phía máy chủ
và đọc điểm theo Firebase JWT, nhưng chưa được phép bật trên
Cloudflare D1 Preview đang hoạt động. PR này **không truy cập
Cloudflare, Firebase thật hoặc tài khoản học viên thật**, không
chạy migration/backup/restore, không đổi `main` hoặc feature flags.

Phase7E kiểm thử đường đi **thực của các handler Cloudflare Pages**,
dùng 4 máy khách GIẢ LẬP (mỗi máy có một kết nối SQLite riêng nhưng
tất cả dùng chung một file SQLite thử nghiệm):

1. **Máy A / Học viên A:** đăng nhập JWT giả được ký RSA trong
   bộ test, bắt đầu phiên làm bài toán DEMO 5 phút do DB đặt thời
   hạn, nộp 1 lần và nhận 10/10.
2. **Điện thoại B / Cùng học viên A:** mang một JWT độc lập của
   cùng UID, `read` thấy cùng session; `result` và lịch sử
   từ database đều thấy 10/10. Không phải dữ liệu localStorage.
3. **Trình duyệt C / Học viên B:** khác UID/token, không thể đọc
   kết quả A hay sử dụng session A; tự nộp câu sai thì nhận 0/10.
4. **Máy D / Google Admin staging:** JWT ký thử với `google.com`,
   xem danh sách hai học viên DEMO và tổng hợp 2 lượt,
   trung bình 5/10; không đọc được đáp án, UID và password hash.
5. **Kết nối chập chờn:** Máy chủ đã ghi 1 lần nhưng phản hồi mất;
   phía máy khác chỉ gửi `result` và `list` để khôi phục điểm,
   **không tự POST `submit` lần hai**. Trường hợp retry có chủ
   ý bằng câu trả lời cũ trả kết quả đã tồn tại; thay đáp án
   không thể ghi đè kết quả.
6. **Đổi tài khoản A→B:** React `key={firebaseUser.uid}` được
   gắn vào ba màn hình thi/lịch sử/điểm Admin, buộc tạo mới
   component khi Firebase UID thay đổi. Mục tiêu là xóa trạng
   thái câu trả lời/điểm trong bộ nhớ; phía server cũng ràng
   buộc kết quả theo token. PWA SW chỉ cache tệp tĩnh có hash,
   không cache API, JWT, điểm hay HTML đăng nhập.

Đây là **mô phỏng nhiều máy khách, không phải nhiều điện thoại thật**:
SQLite trong một tiến trình không kiểm chứng độ trễ Internet,
quota D1/Worker, race thực giữa vùng Cloudflare hoặc push realtime.
Việc xem điểm hiện nay là **đọc lại từ D1 theo yêu cầu**, không phải
WebSocket/live push. Cần bấm tải lại hoặc đồng bộ.

## Bằng chứng CI

Chạy các test mới và các test Phase4–7 đã có:

    node --test tests/phase7e-multidevice-shared-d1-http.test.mjs
    bun test tests/phase7e-multidevice-browser-recovery.test.ts
    node --test tests/phase7e-account-state-isolation.test.mjs
    bun run lint
    bun run build

Test tạo dữ liệu **chỉ toán giả** trong thư mục tạm. Không có
API Cloudflare và không sử dụng Firebase account/key thật.
Các biến/toggles trong fixture là mô phỏng chỉ cho test:
không thay đổi giá trị thực của Cloudflare.

## Quy trình nghiệm thu thực tế trên Preview (CHƯA LÀM)

**Cửa an toàn bắt buộc trước khi thử:**

- người quản trị đối chiếu đúng Cloudflare Pages staging SHA và
  pinned hostname `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`;
- Cloudflare Access bảo vệ branch alias/hashed URLs; hostname Pages
  canonical và custom domain được kiểm tra riêng;
- Preview binding `AUTH_DB_PREVIEW` đúng database ID đã xác nhận
  của `duongtrcnhiem-auth-preview`, không trỏ D1 Production;
- bản backup mới đã được kiểm tra và thử phục hồi trên DB phụ cô lập,
  các migration Phase6 bản nháp được rà soát/phê duyệt và chỉ chạy
  trên đúng D1 Preview sau cho phép riêng;
- Firebase staging, người kiểm thử có quyền, cờ DEMO cần thiết
  chỉ bật riêng cho Preview trong khoảng thử nghiệm được duyệt;
- toàn bộ dữ liệu chỉ là tài khoản/đề **toán giả**, không có người
  hay tài liệu nội bộ thật.

**Kịch bản thủ công sau khi các điều kiện trên được duyệt:**

| Máy | Vai trò | Các bước | Kết quả mong đợi |
| --- | --- | --- | --- |
| PC A | Học viên DEMO A | Login, mở đề, bắt đầu, nộp | 1 phiên, 1 điểm do D1 lưu |
| Điện thoại B | Cùng DEMO A | Login phiên khác, mở lại đề, đọc kết quả | Cùng session và điểm, không POST lại |
| Trình duyệt C | Học viên DEMO B | Đọc điểm, thử dùng session A | Không xem được điểm/session A |
| PC D | Google Admin staging | Tải summary/danh sách điểm | Chỉ tài khoản DEMO và điểm, không đáp án |
| Mất mạng | Học viên DEMO A | Ngắt mạng khi gửi submit, nối lại, đọc kết quả | Không tự nộp 2 lần; trạng thái chưa xác nhận thì báo rõ |
| PWA | Đăng xuất A, vào B | Cài, đăng xuất, đăng nhập khác, xem lại | Không có điểm/đáp án A trong cache của B |

Đối chiếu server-clock, duplicate 409, 401/403, no-store;
không lưu JWT, ID người dùng thật, mật khẩu, backup hoặc ảnh màn
hình riêng tư trong báo cáo. Mất kết nối có thể khiến trạng thái
chưa xác nhận; **không đoán là đã ghi thành công** khi đọc
server vẫn thất bại.

Cần kiểm thử thêm 30→60→100 phiên đồng thời thật trên Preview
cô lập với kế hoạch tải đã duyệt; bộ CI này không phải phép đo
chịu tải. Những bài thử này chỉ là điều kiện chuẩn bị cho một
quyết định vận hành tách riêng, không có cờ nào tự bật sau merge.

## Trạng thái

| Tiêu chí | Phase7E |
| --- | --- |
| Tích hợp signed A/B/Admin và cùng SQLite file (CI offline) | Có bộ kiểm thử |
| Browser mất response và không tự nộp lại (CI offline) | Có bộ kiểm thử |
| Giao diện đổi UID không giữ điểm cũ | Đã sửa React key và có test |
| Chính sách service worker tránh cache điểm/tokens | Có test hồi quy |
| Cloudflare Preview/D1 live nhiều thiết bị | **CHƯA NGHIỆM THU** |
| Kiểm thử PWA cài trên Android/iOS/Windows thật | **CHƯA NGHIỆM THU** |
| 30–100 người dùng thật/khả năng vận hành | **CHƯA NGHIỆM THU** |
| D1 migrations, backup/restore thật, Production | **KHÔNG THỰC HIỆN** |

**NO-GO cho đưa điểm/đề thi chính thức ra vận hành.**
Merge PR28 chỉ thêm mã nguồn/kiểm thử vào Staging.
