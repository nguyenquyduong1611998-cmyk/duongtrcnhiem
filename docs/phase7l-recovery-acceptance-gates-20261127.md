# Bước 117 / Phase 7L — Nghiệm thu an toàn khôi phục phiên thi sau mất mạng

Ngày: 27/11/2026. Phạm vi: **DEMO toán giả, Preview-only**, kế thừa Phase 7K/PR #35.

## Mục tiêu

Kiểm tra bằng chứng rằng phiên thi, deadline và điểm được quyết định bởi máy chủ D1; tránh nhầm lẫn giữa lỗi mạng và việc nộp thành công. Không triển khai/bật tính năng trong bước này.

## Điều kiện chặn trước mọi kiểm thử live

- [ ] Xác minh chính xác hostname Preview đang chạy commit tương ứng PR #35; không thử trên Production/main.
- [ ] Cloudflare Access/biện pháp hạn chế truy cập Preview đã được kiểm chứng, không chỉ dựa vào URL khó đoán.
- [ ] Xác nhận Preview dùng **AUTH_DB_PREVIEW** riêng, không fallback sang D1 canonical/production.
- [ ] Có bản sao lưu Preview D1 gần nhất và đã kiểm tra phương án khôi phục trên môi trường cô lập.
- [ ] Đối chiếu migration/schema bằng quy trình review riêng, không tự chạy SQL từ tài liệu.
- [ ] Chỉ dùng tài khoản và câu hỏi **DEMO giả**; tuyệt đối không dùng dữ liệu cá nhân/đề thật/kết quả B, C, D.
- [ ] Việc bật bất kỳ `PHASE6_*` nào cần phê duyệt vận hành **riêng**; không coi PR/CI xanh là phê duyệt.

Nếu thiếu bất cứ điều kiện nào, **dừng kiểm thử live**; chỉ chạy bài kiểm thử offline trên nhánh thử nghiệm.

## Ma trận nghiệm thu PC/iPhone — chỉ thực hiện sau khi vượt đủ điều kiện chặn

| Kịch bản | Thao tác dự kiến | Kết quả cần đối chiếu |
| --- | --- | --- |
| Mất phản hồi khi bắt đầu | Server tạo session, client không nhận được response; bấm **Đọc lại phiên từ D1** | Cùng sessionId, startedAt/expiresAt cũ; không tự POST start lần hai |
| Tắt mạng rồi mở lại PWA | Tắt mạng khi đang thi, mở lại trên iPhone/PC | Có thể hiện offline fallback; không hứa khôi phục đáp án chưa nộp hoặc tự chấm |
| Mất phản hồi khi nộp (server đã lưu) | POST submit đã commit nhưng mất response; bấm **Đọc lại kết quả từ D1** khi có mạng | Hiện điểm ghi tại D1, nút nộp vẫn khóa, không phát sinh attempt mới |
| Mất phản hồi khi nộp (server chưa lưu) | POST không đến server; đọc kết quả trả null | Chỉ cho phép nộp lại bằng thao tác thủ công và nếu còn thời gian server |
| Đã quá hạn | PC/iPhone thử nộp sau expiresAt | Máy chủ từ chối; sửa giờ điện thoại không gia hạn |
| Hai thiết bị cùng UID | PC bắt đầu, iPhone đọc lại cùng UID | Cùng deadline/phiên; **đáp án chưa nộp không đồng bộ** |
| Khác UID | B đăng nhập sau A | B không xem được câu trả lời/điểm của A |
| Admin | Sau khi nộp thành công, Admin tải danh sách | Kết quả trùng với bản lưu D1, không lấy từ localStorage |
| Mạng mất khi đọc kết quả | Nhấn đọc kết quả khi offline | Báo chưa xác minh, không báo đã lưu và không tự submit |
| Thoát/đăng nhập lại | Sau submit chưa rõ kết quả, reload hoặc đổi account | Không hiển thị kết quả UID cũ; phải kiểm tra D1 trước khi quyết định bước sau |

## Bằng chứng cần ghi lại

Chỉ ghi trạng thái **PASS/FAIL/BLOCKED**, timestamp, môi trường (Preview), SHA triển khai và mô tả lỗi đã loại bỏ thông tin cá nhân. Không đưa ID Token, cookie, UID, đáp án, câu hỏi thật, ảnh dữ liệu riêng, bản sao D1 hoặc secret vào issue/PR/log.

## Kiểm thử tự động offline

```sh
bun test tests/phase7k-offline-start-submit-browser.test.ts
bun run lint
bun run build
```

CI và bộ test giả lập **không chứng minh** PWA trên iPhone thật, bảo vệ Cloudflare Access hay cấu hình D1. Không suy luận PASS từ việc chưa thực hiện kiểm thử.

## Tiêu chuẩn hoàn tất

- Các điều kiện chặn có bằng chứng độc lập, sau phê duyệt riêng mới chạy kiểm thử live.
- Ghi đủ kết quả PC/iPhone/khác UID/Admin; mọi lỗi liên quan phân quyền, nộp trùng, gia hạn deadline đều phải được xử lý trước triển khai.
- Không tự gộp nhánh này; không sửa backend/API/SQL/Firebase/Cloudflare/config flags/main/Production.
