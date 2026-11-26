# Giai đoạn 7D — kiểm tra khả năng khôi phục bản sao SQLite cô lập

Ngày: 26/11/2026. Tiếp nối Phase7C/PR26 đã gộp.
**Cloudflare Pages + Functions + D1 + Firebase Auth + PWA, KHÔNG VPS.**

## Kết quả và giới hạn

Phase7D thêm chương trình kiểm tra **chỉ đọc trên hai file .sqlite/.db
đã tồn tại sẵn trên máy** (bản nguồn và bản ứng viên khôi phục).
Chạy trên dữ liệu thử nghiệm trong GitHub Actions.
**Không liên hệ Cloudflare, không gọi mạng, không chạy migration, không
thực thi nội dung file .sql và không tạo/restore D1 thật.**

Không có Cloudflare D1 binding token/ID hay bản xuất thực tế trong CI.
Chưa xác thực D1 Preview đang được bảo vệ bởi Cloudflare Access.
Chưa khôi phục backup thật lên database độc lập.
Không dùng kết quả CI làm bằng chứng vận hành đạt yêu cầu.

## 1. Tình trạng bản xuất SQL và SQLite

Cloudflare D1 export thường tạo file **.sql gồm schema và dữ liệu**,
không phải file SQLite nhị phân. File .sql KHÔNG được đưa vào công cụ
7D này, vì chương trình tuyệt đối không thực thi nội dung SQL bên ngoài.

Lộ trình chuẩn khi đã được cấp phép:

1. Vào Dashboard, kiểm tra chính xác Preview alias, Access policy,
   binding `AUTH_DB_PREVIEW` và D1 database ID khớp. Không đưa
   ID/JWT/secret/ảnh nhạy cảm lên GitHub/chat.
2. Người vận hành dùng quyền Cloudflare phù hợp **và đồng ý thời điểm
   thao tác** để xuất backup D1 Preview ra file SQL trên máy riêng.
   Bảo vệ file bằng quyền filesystem và không lưu lên Git/CI/chat.
3. Dùng scanner tĩnh của Phase7B đối chiếu 2 bản file SQL. Đây chỉ là
   kiểm tra byte và cấu trúc, chưa phải restore thật.
4. Nếu SQL đã được thẩm định riêng, người vận hành phải tạo **bản
   SQLite nhị phân phục hồi thử trong môi trường riêng biệt/cô lập**.
   Việc thực thi file SQL để tạo SQLite có thể chạy lệnh trong bản
   xuất, nên không tự động hóa trong repo hoặc làm trên máy/tài khoản
   không đáng tin cậy. Tương tự, không chạy `wrangler d1 execute
   --remote` để thử restore trên D1 Preview đang hoạt động.
5. Có hai file SQLite riêng **đã được chuẩn bị theo quy trình được
   phê duyệt** (bản nguồn đã biết và bản restore ứng viên): chạy
   công cụ 7D trên máy của người vận hành để kiểm tra chỉ đọc.
   Hai file không được trỏ cùng một đường dẫn, hardlink hoặc symlink;
   không chứa journal đang hoạt động.
6. Đối chiếu độc lập rằng bản nguồn đúng là backup mới từ đúng
   D1, thời gian xuất, tính đầy đủ và quy trình khôi phục.
   Phải kiểm tra cả cloud Access/restore/khả năng ghi đọc trên DB phụ.
   Công cụ 7D **không** thay thế các bước này.

Tài liệu Cloudflare:
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/d1/reference/time-travel/

**CẢNH BÁO:** D1 Time Travel restore là thao tác ghi đè trực tiếp
vào database được chọn, hủy trạng thái hiện tại. Cloudflare Time
Travel hiện không hỗ trợ clone/fork database sang database mới. KHÔNG
dùng Time Travel restore để thử trên D1 đang phục vụ website.
D1 export .sql và SQLite snapshot là hai định dạng khác nhau.

## 2. Lệnh kiểm tra local SQLite (Windows PowerShell)

Chạy từ thư mục clone GitHub đã cập nhật:

    # 2 file .sqlite đã được chuẩn bị và tách biệt trước đó.
    # Không dùng file .sql do Wrangler export làm đầu vào.
    node .\scripts\phase7d-verify-restored-sqlite.mjs "C:\private\source.sqlite" "C:\private\restore-candidate.sqlite"

Lệnh trên:

- đọc header `SQLite format 3`, từ chối symlink, hardlink, file
  thiếu/lỗi và file lớn hơn 256 MiB;
- mở cả hai tệp bằng `DatabaseSync(...,{readOnly:true})`;
- thực hiện `PRAGMA integrity_check` và
  `PRAGMA foreign_key_check` trên cả hai;
- dùng bộ kiểm tra metadata Phase7A để xác minh Phase4/5 baseline,
  6B → 6C → 6A → 6D, trigger và index thiết yếu;
- so sánh **tổng số dòng** của 8 bảng Phase4/5 giữa bản nguồn và
  bản ứng viên mà **không in số dòng hoặc dữ liệu**;
- kiểm tra byte hash SHA-256 trước/sau để nhận biết file bị đổi
  trong lúc kiểm tra nhưng **không in giá trị SHA, đường dẫn file,
  UID, mật khẩu, câu trả lời, điểm hay nội dung SQL**;
- có kết quả `LOCAL_SNAPSHOT_COMPARISON_REVIEW_ONLY` hoặc
  `BLOCKED`. Cả hai đều giữ `deploymentAllowed:false`.

Ngay cả trường hợp bản SQLite ứng viên có Phase6 schema đầy đủ,
trạng thái `SCHEMA_CANDIDATE_REVIEW_ONLY` **chỉ chứng tỏ hình dạng
schema có vẻ đúng**, không chứng minh đã chạy migration thật.
Nếu dữ liệu nguồn chỉ chứa Phase4 (chưa đủ Phase5), báo BLOCKED:
cần kiểm tra lại trạng thái Preview, không tự thêm schema để làm xanh.

**Khả năng bị bỏ sót:** Công cụ so sánh tổng số dòng chứ không
chứng minh các giá trị của từng bản ghi giống nhau, nguồn là đúng
D1 Cloudflare, hay bản copy có thể đảm đương truy vấn ứng dụng thực.
Vì vậy cần thử độc lập từng chức năng ở DB phụ dưới quyền người vận hành.

## 3. Kế hoạch xác minh Preview, quyền và thiết bị

Chỉ sau khi có phê duyệt phù hợp:

- xác minh GitHub HEAD commit và Cloudflare Pages deploy cùng SHA,
  Access policy trên Preview alias, hashed URLs và hostname canonical;
- xác minh Preview D1 ID/binding bằng Dashboard, cờ mặc định OFF;
- kiểm tra phục hồi độc lập và rà soát file backup thật mới;
- đăng nhập A trên PC, mở lại trên điện thoại B, nộp một lần, so
  điểm do máy chủ lưu, thử học viên khác không đọc được, Admin chỉ
  xem điểm cho phép, mất mạng không auto POST;
- kiểm tra PWA cài thật Android/iOS/Windows, thoát/chuyển tài khoản
  không cache điểm/đáp án;
- thống nhất tiêu chí tải trước khi đo 30→60→100 tài khoản DEMO thật.
  Dùng nội dung toán giả, không dùng dữ liệu học viên hoặc bài thi thật.

**Không gộp 7D trực tiếp vào main.** Mọi feature flag và D1 migration
vẫn không bật, các bước Cloudflare live phải có chấp thuận riêng.

## 4. CI và nghiệm thu mã nguồn

    node --test tests/phase7d-restored-sqlite-verification.test.mjs
    bun run lint
    bun run build

CI chỉ tạo SQLite **dữ liệu hoàn toàn giả** và kiểm tra khôi phục/
schema trên file thử local, không tạo hay dùng database Cloudflare.

**NO-GO cho thi chính thức** khi backup/Access/binding/thiết bị/thử
tải thực tế chưa được nghiệm thu.
