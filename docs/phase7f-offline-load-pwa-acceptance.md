# Giai đoạn 7F — diễn tập 30–60–100 học viên và PWA an toàn (không VPS)

Ngày 26/11/2026. Tiếp nối Phase 7E đã gộp qua PR28.
Mô hình **Cloudflare Pages + Functions + D1 + Firebase Auth + PWA**.
Chỉ dùng dữ liệu toán học DEMO giả trong kiểm thử.

## Phân biệt bằng chứng kiểm thử và khả năng vận hành thực tế

**Được làm ở 7F (offline):**

- 30, sau đó 60, sau đó 100 học viên mô phỏng (tổng tích lũy)
  thực hiện `start` + `submit`, `result`, `history` bằng các
  **handler Phase6 thật**, trên một file SQLite tạm cục bộ.
- Bốn SQLite connections độc lập đại diện cho các máy khách nhưng
  đều chạy trong **một tiến trình Node**, driver đồng bộ. `Promise.all`
  không tương đương 100 yêu cầu HTTP đồng thời hay 100 thiết bị thật.
- Mỗi lượt thi sinh một session, một bài nộp duy nhất; kiểm thử
  đọc kết quả trên kết nối khác, điểm do máy chủ giả lập tính,
  điều kiện khóa ngoại và `PRAGMA integrity_check`.
- Admin đọc summary và trang danh sách 25 kết quả; kiểm tra 2 / 3 /
  4 trang ứng với 30 / 60 / 100 học viên. Không xuất đáp án,
  Firebase UID, password hash hoặc SQL hàng dữ liệu ra báo cáo.
- Kiểm tra retry **thủ công** của cùng payload là idempotent,
  còn payload có đáp án khác bị 409; không có tự POST khi mất mạng.
- PWA service worker chạy trong Node VM: đang online chỉ cache
  tài nguyên tĩnh cùng origin, tên file có hash. Mất mạng và đổi
  tài khoản A→B không bao giờ đọc API/điểm/HTML từ cache. URL
  tài nguyên có `?query` bị bỏ qua, không cache token/điểm trong URL.
  Cache Preview đổi phiên bản **v1→v2** để xóa các cache tĩnh cũ
  khi service worker phiên bản mới activate.

**CHƯA làm và KHÔNG được tuyên bố đạt:**

- 30–100 người dùng đồng thời qua Internet, Cloudflare Workers
  và D1 real throughput, latency p50/p95/p99, quota, vùng mạng,
  chi phí hoặc load spike;
- cài PWA thật trên iOS/Android/Windows, đo offline/online thực tế;
- Cloudflare Access policy, D1 `AUTH_DB_PREVIEW` database ID,
  migration Phase6A–D, export/restore D1 thật;
- bất kỳ thử nghiệm nào với học viên, đề thi hoặc dữ liệu thật.

## Cách chạy mã kiểm thử offline từ Windows PowerShell

Sau khi cập nhật mã nguồn Staging:

    node --test tests/phase7f-offline-load-30-60-100.test.mjs
    node --test tests/phase7f-pwa-offline-profile-isolation.test.mjs
    node scripts/phase7f-offline-load-rehearsal.mjs

Script tự tạo một DB SQLite **hoàn toàn giả** trong thư mục tạm
của hệ điều hành và đóng/xóa khi kết thúc. Nó không nhận URL,
không dùng Wrangler, không tạo hay gửi request lên mạng.
Đầu ra `OFFLINE_FUNCTIONAL_REHEARSAL_PASSED` có số lượng mô phỏng,
**nhưng luôn** giữ:

    "cloudflareD1LiveLoadMeasured": false
    "actualConcurrentUsersVerified": false
    "latencyPercentilesMeasured": false
    "cloudflareQuotaHeadroomVerified": false
    "realDevicePwaInstalled": false
    "deploymentAuthorized": false

Nếu CI thất bại, không được dùng kết quả commit cũ để phê duyệt
commit mới. Không chỉnh bảng điểm hoặc các rào cản auth để sửa test.

## Kịch bản thực địa 30→60→100: CHỈ LÀ KẾ HOẠCH, KHÔNG TỰ CHẠY

**Bắt buộc trước khi chạy bất kỳ thử tải thật nào:**

1. Chủ hệ thống xác minh đúng Pages branch preview / commit SHA /
   alias đang hoạt động và Cloudflare Access bảo vệ Preview + hashed
   URLs. Xem riêng bảo vệ canonical Pages domain và custom domains.
2. Xác minh `AUTH_DB_PREVIEW` trỏ đúng D1 ID riêng của
   `duongtrcnhiem-auth-preview`. Không chụp/đưa ID, API token,
   backup, JWT, dữ liệu học viên, câu hỏi thực vào GitHub hoặc chat.
3. Có backup D1 Preview mới, lưu riêng và đã phục hồi thử độc lập
   trên DB khác theo thủ tục được duyệt. D1 migration Phase 6 vẫn
   là bản nháp cho tới khi được thẩm định/phê duyệt **riêng**.
4. Firebase staging/Google Admin/học viên DEMO A/B đã được cấu hình
   và quyền xử lý dữ liệu được duyệt; người chịu trách nhiệm ký lịch
   thử tải, mức request rate, thời lượng, phạm vi mạng, ngân sách,
   tiêu chí dừng/rollback và phương án thông báo sự cố.
5. Không bật flags/đưa người dùng vào thi để chạy kiểm thử theo
   tài liệu này. Không thực hiện load test khi chưa có phê duyệt.

**Mẫu ma trận nghiệm thu trên môi trường đã cho phép (chưa chạy):**

| Bước | Thiết bị/nhóm | Kết quả cần đo thực tế |
|---|---|---|
| 1 | 1 PC A + 1 điện thoại A | Cùng session server; đọc điểm đã lưu, không nhân đôi |
| 2 | Học viên B + Admin | B chỉ thấy B, Admin chỉ kết quả cho phép |
| 3 | Mạng rớt lúc nộp | Không tự POST lại; `result` phân biệt đã lưu/chưa lưu/không rõ |
| 4 | PWA Android/iOS/Windows | Cài thử, refresh offline, đăng xuất A→B, không cache điểm A |
| 5 | 30 DEMO accounts | 401/403/409/5xx, success %, latency p50/p95/p99, D1 rows read/write |
| 6 | 60 DEMO accounts | Theo dõi cùng metrics; quota/rate limits/chi phí |
| 7 | 100 DEMO accounts | Theo dõi cùng metrics; lỗi timeout, trùng nộp và giới hạn D1 |
| 8 | Tắt thử nghiệm, khôi phục flags | Xác minh không ảnh hưởng host canonical/Production |

Các bước 5–7 phải có lịch, mức tải được duyệt riêng, chỉ trên
Preview cô lập và tài khoản giả. Không có giá trị p95 hoặc
ngưỡng đáp ứng nào được giả lập/đặt là thực tế trong PR này.
Cần thỏa thuận các ngưỡng nghiệm thu **trước** khi đo. Ghi số
liệu tổng hợp, ẩn UID/JWT/IP và nội dung bài, rồi đối chiếu
Cloudflare Dashboard.

## Cổng NO-GO cuối giai đoạn 7F

| Cổng | Tình trạng |
|---|---|
| 30/60/100 học viên mô phỏng, handler server, SQLite local | Có kiểm thử CI |
| PWA offline/đổi tài khoản không cache API/điểm | Có kiểm thử VM |
| Không cache URL asset có query, rotate cache v2 | Có thay đổi code và kiểm thử |
| 30/60/100 người đồng thời mạng thật | **CHƯA ĐO** |
| PWA cài thật, đổi tài khoản thiết bị thật | **CHƯA ĐO** |
| Cloudflare Access, đúng Preview D1 ID, restore thật | **CHƯA XÁC MINH** |
| Bật Phase 6, migration thật, deploy `main` | **KHÔNG THỰC HIỆN** |

**Kết luận:** PR29 nếu CI đạt chỉ nên gộp vào **Staging**.
Không VPS, không chạm Cloudflare D1 thật, chưa GO cho bài thi thật.
