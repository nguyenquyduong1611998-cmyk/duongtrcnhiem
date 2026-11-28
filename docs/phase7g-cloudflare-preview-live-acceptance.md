# Phase 7G — nghiệm thu Cloudflare Pages Preview và D1 thật bằng người vận hành có quyền

Ngày lập checklist: **26/11/2026**. Kiến trúc vẫn:
**Cloudflare Pages + Pages Functions + D1 + Firebase Auth + PWA; KHÔNG VPS**.
Chỉ dành cho website DEMO thi toán giả, không phải hệ thống điểm
chính thức. Mọi feature flags vẫn **OFF** ở môi trường thật.

## 0. Những gì đã kiểm chứng và chưa được kiểm chứng

Tại thời điểm bắt đầu Phase7G, GitHub branch
`feature/staging-demo-quiz-pilot` có merge PR29 SHA
`6c154a078b21bb94fe9ad3311a2f8ee5f26e22c2`.
GitHub REST check-runs của **cùng SHA đó** ghi:
`Cloudflare Pages` và `demo-quiz-ci` đều
`completed/success`. Đây chỉ là xác nhận **qua GitHub**.

**Chưa có quyền đọc Dashboard Cloudflare trong phiên này**;
không biết hiện trạng Access, preview alias thực đang trỏ SHA nào,
binding `AUTH_DB_PREVIEW`, D1 backup, khôi phục hay cài PWA thật.
Nếu Staging cập nhật sau PR30 hoặc commit bất kỳ, SHA quan sát
trên cần bỏ và phải lấy HEAD **mới nhất** trước khi nghiệm thu.

Phase7G **không tự**:
- gọi cloud API/dashboard, gửi yêu cầu HTTP đến site, chạy curl;
- mở kết nối Firebase/D1 thật, xuất/khôi phục dữ liệu hay chạy migration;
- đăng nhập tài khoản học viên, bật flags, thử tải 30–100 qua Internet;
- sử dụng tài khoản dữ liệu thật hoặc tạo báo cáo chứa JWT,
  database ID, backup, địa chỉ riêng tư, mật khẩu hoặc nội dung đề.

## 1. Kiểm tra bất kỳ máy nào cũng an toàn — Github metadata only

Trên bản clone GitHub Staging:

    # Lệnh này chỉ in hướng dẫn, KHÔNG gọi mạng
    node .\scripts\phase7c-github-deployment-evidence.mjs

    # Chỉ đọc metadata GitHub public khi người vận hành CHO PHÉP
    node .\scripts\phase7c-github-deployment-evidence.mjs --allow-github-metadata

Bản GitHub chính xác phải có `Cloudflare Pages` và `demo-quiz-ci`
success trên **HEAD hiện tại**, cả kiểm tra HEAD trước/sau
đều cùng SHA. KHÔNG coi kết quả đó là kiểm chứng Cloudflare Access
hoặc database.

## 2. Danh sách nghiệm thu trực tiếp trong Cloudflare Dashboard

**Yêu cầu:** người quản trị có quyền, chỉ dùng dữ liệu toán DEMO,
xác nhận chính sách bảo vệ riêng và lịch thử được duyệt trước.

1. **Trang triển khai đúng SHA**: Dashboard → Workers & Pages →
   project `duongtrcnhiem-test` → Deployments. Kiểm tra
   branch `feature/staging-demo-quiz-pilot`, deployed SHA bằng
   current GitHub HEAD và **branch alias**
   `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`.
   Đối chiếu thêm hashed URL bản mới trong Dashboard; không lấy
   hashed URL của commit cũ. Branch alias có thể di chuyển sau push.
2. **Không đăng nhập phải bị từ chối**: mở ẩn danh từ mạng kiểm thử
   được cấp phép, kiểm tra Access chính sách đủ chặt ở cả branch
   alias lẫn hashed deployment URLs (bao gồm URL deploy trước đó).
   `200` hiển thị ứng dụng cho anonymous = **BLOCKED**; `403`
   cũng có thể là WAF, **không đủ** chứng minh Access đúng.
   Dashboard phải có Access app/policy thực và danh sách người
   được quyền đã đối chiếu. Kiểm tra account khác không được phép.
3. **Pages canonical host / custom domain**:
   `duongtrcnhiem-test.pages.dev` cần được kiểm tra **riêng**;
   wildcard Preview Access không tự bảo vệ canonical host.
   Kiểm tra domain bổ sung nếu có, không cho rằng không tồn tại.
4. **D1 Preview binding đúng ID**: Settings → Bindings, chọn
   Preview environment. So sánh **database ID riêng trong
   Dashboard** của `AUTH_DB_PREVIEW` với
   `duongtrcnhiem-auth-preview`, không chỉ đối chiếu tên.
   Không nhầm `AUTH_DB` của canonical host. Sau khi thay
   binding, Pages cần redeploy để áp dụng.
   **KHÔNG chép database ID/secret vào JSON, GitHub hoặc chat.**
5. **Firebase staging**: xác nhận browser build và Functions
   dùng `duongtrcnhiem-staging`, kiểm tra vai trò Google Admin
   và học viên DEMO không bị trộn Firebase production.
   Kiểm tra cờ UI/API của Phase6 vẫn OFF trừ khi đã có phê duyệt
   riêng đúng Preview URL/nhóm thử.
6. **D1 bản sao và phục hồi**: có bản export SQL **mới**, nguồn
   database ID được kiểm tra riêng, kiểm tra tĩnh bản sao theo
   Phase7B. Thử restore trong database **khác biệt độc lập** theo
   kế hoạch riêng và có quyền; kiểm tra row counts, integrity,
   FK, Phase6 schema. Phase7D kiểm tra bản nhị phân SQLite local
   không đồng nghĩa đã restore D1 cloud. Không chạy Time Travel
   Restore trên database Preview đang hoạt động: thao tác này
   phục hồi **tại chỗ**, không hỗ trợ clone/fork.
7. **DB schema / preflight**: chỉ khi được phê duyệt mới chạy
   preflight Phase7A vốn mặc định OFF và read-only. Nếu thiếu
   migrations Phase6A–6D, coi là `NOT_READY`, **không chạy SQL
   tự động** để tạo bảng. Migration là quyết định khác biệt phải
   duyệt riêng sau có backup.
8. **Đa thiết bị thật**: PC học viên A làm đề toán DEMO, điện
   thoại A login bằng session Firebase khác và tải lại
   server-owned session/result; học viên B không thấy A,
   Admin thấy bảng điểm theo quyền. Ngắt mạng lúc nộp:
   không tự retry `submit`, đọc lại điểm và phân biệt trường hợp
   chưa xác nhận. Không mang màn hình người dùng thật vào log.
9. **PWA thật**: cài thử Android/iOS/Windows theo thiết bị có sẵn,
   offline trang thi và API không được mở từ cache; thoát A,
   vào B phải không còn điểm/đáp án/tài liệu A. Kiểm tra
   service-worker cache v2 và không cache URL chứa `?query`.
10. **30→60→100 mạng thật**: CHỈ sau phê duyệt riêng với
    phạm vi, giờ, quyền test, request/sec, ngân sách,
    giới hạn lỗi và rollback. Thu p50/p95/p99, rate lỗi,
    unique session, chỉ số D1, chi phí/quota từ Cloudflare.
    Bộ mô phỏng Phase7F **không thay thế** phép thử này.
    Chỉ dùng account DEMO và đề toán giả.
11. **Kết thúc**: giữ flags OFF khi không được phê duyệt;
    đăng xuất các tài khoản test, rà soát cấu hình Access,
    backup riêng, không đẩy raw screenshots/logs lên GitHub.

**CẢNH BÁO:** mở URL ẩn danh không thay cho kiểm tra chính sách
trong Dashboard, và `200` không chứng minh website an toàn.
Không thực hiện lệnh ghi/thử tải khi chưa có ủy quyền cụ thể.

## 3. Hai biên bản sạch, không chứa bí mật

Biên bản Phase7C có 12 cổng cấp cao:
`docs/phase7c-operator-evidence-template.json`.
Biên bản Phase7G có 17 kết quả cụ thể:
`docs/phase7g-private-live-acceptance-template.json`.

Người vận hành copy **hai mẫu ra thư mục RIÊNG ngoài GitHub**.
Chỉ cập nhật các trường enum:
- 7C: `NOT_CHECKED`, `REVIEWED_BY_OPERATOR`, `BLOCKED`;
- 7G: `NOT_CHECKED`, `PASSED_BY_OPERATOR`, `FAILED`.

Cả hai cùng chứa đúng `gitCommitSha` của Staging HEAD ở thời điểm
nghiệm thu. Nếu SHA thay đổi (sau merge, deploy khác), **kết quả
kiểm tra cũ là stale**, cần kiểm tra mới, không dùng lại.

**Mỗi field chỉ đánh dấu nếu có bằng chứng thật được quản trị viên
kiểm tra trong hệ thống riêng**. Không tự động đánh dấu PASS
dựa vào GitHub check-run xanh hoặc bài test SQLite local.
Không gõ access token, database ID, họ tên/UID/IP, ảnh màn hình
hoặc SQL backup vào hai JSON. Mọi tài liệu nhạy cảm do đơn vị
quản lý lưu riêng theo chính sách dữ liệu.

    # Kiểm tra mẫu trắng, offline, không kết nối bất kỳ dịch vụ nào:
    node .\scripts\phase7g-preview-acceptance-gate.mjs

    # Sau khi quản trị viên tự đối chiếu chính xác SHA trên GitHub:
    node .\scripts\phase7g-preview-acceptance-gate.mjs "SHA40_CUA_STAGING_HEAD" "C:\private\phase7c-reviewed.json" "C:\private\phase7g-reviewed.json"

Kết quả:
- `BLOCKED_INVALID_EVIDENCE`: sai JSON/schema, symlink/hardlink,
  file quá lớn hoặc có trường tùy ý/secret.
- `STOP_STALE_OR_INCONSISTENT_SHA`: ít nhất một biên bản không
  khớp SHA Staging do người vận hành nhập riêng.
- `STOP_OPERATOR_REPORTED_FAILURES`: một hoặc nhiều cổng
  bị người vận hành đánh dấu FAIL/BLOCKED.
- `EXPECTED_HEAD_SHA_NOT_INDEPENDENTLY_SUPPLIED`: không
  cung cấp SHA, không thể kết luận có đủ bằng chứng.
- `OPERATOR_EVIDENCE_INCOMPLETE`: còn trường NOT_CHECKED.
- `SELF_REPORTED_COMPLETE_REQUIRES_INDEPENDENT_APPROVAL`:
  **chỉ** báo đủ 12+17 cờ mà người vận hành tự khai, vẫn
  **không có bất kỳ quyền cho phép triển khai nào**.

Chương trình chỉ in đếm trạng thái; không in đường dẫn, SHA,
dữ liệu, kết quả riêng tư hay nội dung các file. Tham số SHA
được nhập từ người vận hành, phần mềm **không** tự xác minh SHA
đó trên GitHub hay Cloudflare; phải đối chiếu riêng trong hai hệ thống.

## 4. Phạm vi an toàn, điều kiện quyết định sau 7G

**PR30 nếu đạt CI chỉ gộp vào Staging**. Không bật tính năng,
chạy migrations/exports/restores, triển khai Production,
thử tải Internet hay xử lý dữ liệu nội bộ thật.

Cổng GO/NO-GO cho thử nghiệm có quyền là **quyết định độc lập của
người quản trị và người chịu trách nhiệm bảo mật** sau nghiệm thu,
không thể cấp tự động bằng một file JSON hay CI. Mặc định vẫn NO-GO.

## Tài liệu Cloudflare cập nhật

- Preview deployments, alias, Access mặc định:
  https://developers.cloudflare.com/pages/configuration/preview-deployments/
- Access cho canonical `*.pages.dev` và custom domains:
  https://developers.cloudflare.com/pages/platform/known-issues/
- Preview D1 bindings và yêu cầu redeploy sau khi đổi binding:
  https://developers.cloudflare.com/pages/functions/bindings/
- D1 Time Travel, lưu ý restore tại chỗ và chưa hỗ trợ fork:
  https://developers.cloudflare.com/d1/reference/time-travel/
