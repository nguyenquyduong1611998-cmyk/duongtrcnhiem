# Giai đoạn 7C — bằng chứng triển khai Cloudflare Preview và cổng nghiệm thu (NO VPS)

Ngày kiểm tra: **26/11/2026**. Nhánh mục tiêu: **feature/staging-demo-quiz-pilot**.
Kiến trúc giữ nguyên: Cloudflare Pages + Pages Functions + D1 + Firebase
Authentication + PWA, **không cần VPS/IP tĩnh**.

## 1. Đã xác minh được từ GitHub trong phiên làm việc 7C

Theo GitHub REST API public (không truy cập tài khoản Cloudflare):

- PR25 đã MERGED, commit: `ac918aaea0a7379c6932f7723f9d6d4e876841d3`.
- Nhánh Staging `feature/staging-demo-quiz-pilot` tại thời điểm
  tra cứu đang trỏ về chính commit này.
- GitHub Check Runs **của chính SHA này** gồm:
  `Cloudflare Pages: completed / success` với tiêu đề
  `Deployed successfully`, và
  `demo-quiz-ci: completed / success`.
- Check run Cloudflare Pages trỏ tới một deployment của Pages project
  `duongtrcnhiem-test`. Điều này chỉ là tín hiệu từ GitHub và hệ thống
  tích hợp; **không** phải kết quả đọc Dashboard D1 hay xác minh
  chính sách Cloudflare Access/alias đang hoạt động.

**Cảnh báo:** Sau khi PR26 được gộp, SHA Staging sẽ đổi. Phải kiểm tra
lại **commit mới nhất**; tín hiệu xanh của SHA cũ không chứng minh bản
mới triển khai hoặc có bảo mật đúng.

Tham khảo quan sát GitHub: commit `ac918aaea0a7379c6932f7723f9d6d4e876841d3`
trong repository
`nguyenquyduong1611998-cmyk/duongtrcnhiem`.

## 2. Công cụ GitHub public check chạy khi người vận hành cho phép

`scripts/phase7c-github-deployment-evidence.mjs` chỉ đọc các REST
endpoint công khai GitHub của **repo và nhánh Staging cố định**:

1. GET metadata của nhánh `feature/staging-demo-quiz-pilot`.
2. GET Check Runs của **chính HEAD SHA**.
3. GET lại metadata nhánh để chặn trường hợp HEAD đổi trong lúc đọc.

Chỉ khi cả hai check `Cloudflare Pages` và `demo-quiz-ci` đều
`completed/success` ở cùng HEAD SHA, mới trả
`GITHUB_CHECKS_REPORTED_SUCCESS`. Dù thành công, luôn xuất:

`deploymentAuthorized:false`,
`livePreviewAliasVerified:false`,
`cloudflareAccessVerified:false`,
`previewDatabaseBindingVerified:false`,
`d1BackupVerified:false`.

Lệnh PowerShell từ repo mới nhất:

    # Mặc định không kết nối mạng, không cần token:
    node .\scripts\phase7c-github-deployment-evidence.mjs

    # Chỉ sau khi được cho phép đọc public GitHub metadata:
    node .\scripts\phase7c-github-deployment-evidence.mjs --allow-github-metadata

Không có `wrangler`, D1 query, Cloudflare REST admin API, cookie, JWT
hay GitHub token trong công cụ. Không bật tự động trong CI.

## 3. Biên bản kiểm tra do người vận hành giữ riêng

Copy **mẫu JSON không chứa thông tin cá nhân** tại
`docs/phase7c-operator-evidence-template.json` sang thư mục nội bộ riêng
trên máy; **không commit bản đã điền lên GitHub**.

Các mục **NOT_CHECKED** cần người được quyền kiểm tra thủ công:

- đúng branch Preview alias và deployment SHA tại Cloudflare Dashboard;
- bảo vệ Cloudflare Access trên branch preview và hashed preview URLs;
- bảo vệ host Pages test canonical (không nhầm với Access chỉ bảo vệ Preview);
- binding `AUTH_DB_PREVIEW` trỏ **đúng D1 Preview ID** (đối chiếu riêng
  trong Dashboard, không ghi số ID vào JSON hoặc gửi trong chat);
- cấu hình Firebase staging cho build;
- bản export D1 Preview mới được lưu trong vị trí an toàn;
- khôi phục bản sao **độc lập** và kiểm tra integrity, row counts;
- signed Google Admin + học viên A/B trên hai thiết bị với toán DEMO;
- PWA cài thử và chuyển tài khoản không lộ điểm cũ;
- bài kiểm thử tải mạng thực tế 30→60→100 khi được phê duyệt;
- chấp thuận phân loại dữ liệu/nhóm người được truy cập.

Chỉ điền `REVIEWED_BY_OPERATOR` nếu đã tự kiểm tra trong Dashboard hoặc
thực hiện nghiệm thu có thẩm quyền; điền `BLOCKED` nếu phát hiện lỗi.
Cột `gitCommitSha` chỉ cho phép chuỗi SHA 40 ký tự công khai hoặc null.
**Không đưa database ID, access token, secret, account ID, tên người,
mật khẩu, bản backup, điểm hay ảnh chụp nhạy cảm vào JSON.**

Dùng lệnh:

    node .\scripts\phase7c-operator-evidence-gate.mjs

    # Dùng bản JSON đã điền và lưu riêng:
    node .\scripts\phase7c-operator-evidence-gate.mjs "C:\private\phase7c-reviewed.json"

Bản báo cáo chỉ in số lượng nhóm được xét và nhóm chưa xét, **không in
nội dung file/đường dẫn/commit**. Bất cứ trường nào không được cho phép,
giá trị lạ, symlink hoặc file quá lớn đều bị `BLOCKED_INVALID_LEDGER`.
Kể cả khi mọi giá trị được điền `REVIEWED_BY_OPERATOR`, công cụ vẫn
trả `ALL_SELF_REPORTED_REQUIRES_INDEPENDENT_AUTHORIZATION`, với
`deployAuthorized:false`. Tuyên bố của người vận hành không thay thế
được bằng chứng độc lập và phê duyệt người chịu trách nhiệm.

## 4. Đối chiếu quan trọng trong Cloudflare Dashboard

**Chưa thực hiện bởi ChatGPT, vì phiên này chưa được cấp quyền đọc
tài khoản Cloudflare.** Người quản trị kiểm tra trực tiếp:

1. Cloudflare Dashboard → Workers & Pages → `duongtrcnhiem-test` →
   Deployments. Chọn đúng branch `feature/staging-demo-quiz-pilot`.
   Đối chiếu commit SHA với **HEAD hiện tại trên GitHub**;
   chọn đúng bản branch alias
   `feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev`.
   Không lấy hashed URL của một deploy cũ làm bằng chứng alias mới.
2. Settings → General → **Enable access policy** cho Preview, kiểm tra
   Cloudflare Access chính xác trên branch alias **và hashed URL**.
   Cloudflare docs xác nhận Preview deployments mặc định công khai;
   chính sách Preview riêng có thể **không bảo vệ**
   `duongtrcnhiem-test.pages.dev` canonical hoặc custom domain.
   Cần kiểm tra chính sách của các host còn lại riêng biệt.
3. Settings → Variables/Bindings Preview: đối chiếu `AUTH_DB_PREVIEW`
   với `duongtrcnhiem-auth-preview` bằng database ID trong tài khoản
   Cloudflare. **Không tin chỉ tên, hostname hay cờ UI.**
   Xác nhận Firebase staging; không hiển thị/dán API secret.
4. D1 → Backups/Time Travel, đối chiếu cơ chế bảo vệ; **không bấm
   Restore trên DB đang hoạt động**. Export chỉ khi được phép.
   Sau đó thử **restore trên database khác biệt hoàn toàn**, riêng tư
   và có kế hoạch kiểm tra toàn vẹn, không nhập file SQL vào D1 đang dùng.
5. Chỉ sau khi đạt các mục và được phép riêng mới tính tới bật thử
   Phase7A preflight read-only (mặc định OFF), thực hiện kiểm thử
   học viên DEMO A/B/Admin, PWA, tốc độ mạng và rollback logic.
   Mọi migration 6A–6D vẫn là DRAFT, không được chạy ở 7C.

Tài liệu chính thức tham khảo:

- https://developers.cloudflare.com/pages/configuration/preview-deployments/
- https://developers.cloudflare.com/pages/platform/known-issues/
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://developers.cloudflare.com/d1/best-practices/import-export-data/

## 5. Trạng thái nghiệm thu 7C

| Mục | Kết luận |
| --- | --- |
| GitHub Staging SHA PR25 | **Đã đối chiếu** tại 26/11/2026 |
| Cloudflare Pages Check run của SHA đó | **Success** theo GitHub |
| GitHub Actions check của SHA đó | **Success** |
| Cloudflare Dashboard exact branch alias và deployed SHA | Chưa xác minh trực tiếp |
| Cloudflare Access Preview + hashed URL | Chưa xác minh |
| Canonical Pages test Access | Chưa xác minh |
| Binding D1 Preview trùng database ID | Chưa xác minh |
| Backup D1 thật và khôi phục bản sao khác | Chưa thực hiện |
| Test A/B/Admin, PWA, 30–100 mạng thật | Chưa thực hiện |
| Bật features/migrations/main | **KHÔNG làm** |

**Trạng thái cuối: NO-GO** cho vận hành thật và dữ liệu thật.
PR26 chỉ làm rõ bằng chứng và hướng dẫn nghiệm thu, chưa cần VPS.
