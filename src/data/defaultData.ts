import { QuizAttempt, Topic, UserAccount } from '../types';

export const DEFAULT_ACCOUNTS: UserAccount[] = [
  {
    id: 'acc-admin-01',
    username: 'admin',
    password: 'admin123',
    fullName: 'Quản trị viên Tiểu đoàn 3',
    defaultUnit: 'Ban Chỉ huy Tiểu đoàn 3 - Lữ đoàn 490',
    role: 'admin',
    active: true,
    createdAt: '2026-01-01T07:00:00.000Z',
    updatedAt: '2026-01-01T07:00:00.000Z',
  },
  {
    id: 'acc-hv-01',
    username: 'hocvien01',
    password: '123456',
    fullName: 'Tài khoản học viên Đại đội 7',
    defaultUnit: 'Đại đội 7 - Tiểu đoàn 3',
    role: 'student',
    active: true,
    createdAt: '2026-01-05T07:00:00.000Z',
    updatedAt: '2026-01-05T07:00:00.000Z',
  },
  {
    id: 'acc-hv-02',
    username: 'hocvien02',
    password: '123456',
    fullName: 'Tài khoản học viên Đại đội 8',
    defaultUnit: 'Đại đội 8 - Tiểu đoàn 3',
    role: 'student',
    active: true,
    createdAt: '2026-01-05T07:00:00.000Z',
    updatedAt: '2026-01-05T07:00:00.000Z',
  },
];

export const DEFAULT_TOPICS: Topic[] = [
  {
    id: 'topic-tin-hoc-so',
    code: 'CD-01',
    title: 'Tin học văn phòng & An toàn thông tin số',
    description:
      'Kiến thức nền tảng về soạn thảo văn bản hành chính quân sự, bảng tính, bảo mật mạng nội bộ và phòng chống mã độc trong đơn vị.',
    timeLimitMinutes: 15,
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-01-10T08:00:00.000Z',
    questions: [
      {
        id: 'q-ths-1',
        text: 'Trong mạng máy tính quân sự, nguyên tắc quan trọng nhất khi sử dụng USB hoặc thiết bị lưu trữ ngoài là gì?',
        options: [
          'Cắm trực tiếp vào máy tính nối mạng truyền số liệu để sao chép nhanh',
          'Kiểm tra diệt virus tại máy tính cách ly theo đúng quy định bảo mật trước khi sử dụng',
          'Dùng chung USB cá nhân với các máy tính có kết nối Internet công cộng',
          'Tắt phần mềm phòng chống mã độc để tránh làm chậm quá trình sao chép',
        ],
        correctIndex: 1,
        explanation:
          'Thiết bị lưu trữ ngoài phải được kiểm tra, quét mã độc trên máy cách ly chuyên dụng và tuân thủ nghiêm quy định bảo mật thông tin quân sự.',
      },
      {
        id: 'q-ths-2',
        text: 'Khi soạn thảo văn bản hành chính quân sự theo chuẩn Unicode, bảng mã và phông chữ quy định phổ biến là gì?',
        options: [
          'Bảng mã TCVN3 (ABC), phông .VnTime',
          'Bảng mã VNI Windows, phông VNI-Times',
          'Bảng mã Unicode, phông Times New Roman',
          'Bảng mã VIQR, phông Arial Narrow',
        ],
        correctIndex: 2,
        explanation:
          'Theo quy chuẩn văn bản hành chính hiện hành, sử dụng bộ mã ký tự tiếng Việt Unicode (TCVN 6909:2001) và phông chữ Times New Roman.',
      },
      {
        id: 'q-ths-3',
        text: 'Tổ hợp phím nào trong Microsoft Word dùng để lưu nhanh tài liệu đang soạn thảo?',
        options: ['Ctrl + P', 'Ctrl + S', 'Ctrl + F', 'Ctrl + Z'],
        correctIndex: 1,
        explanation:
          'Ctrl + S là tổ hợp phím chuẩn để lưu (Save) tài liệu hiện hành; Ctrl + P để in, Ctrl + F để tìm kiếm, Ctrl + Z để hoàn tác.',
      },
      {
        id: 'q-ths-4',
        text: 'Trong bảng tính Excel, hàm nào dùng để tính trung bình cộng của một dãy số liệu huấn luyện từ ô B2 đến B10?',
        options: [
          '=SUM(B2:B10)',
          '=COUNT(B2:B10)',
          '=AVERAGE(B2:B10)',
          '=MAX(B2:B10)',
        ],
        correctIndex: 2,
        explanation:
          'Hàm AVERAGE(B2:B10) tính giá trị trung bình cộng; SUM tính tổng, COUNT đếm ô có số, MAX tìm giá trị lớn nhất.',
      },
      {
        id: 'q-ths-5',
        text: 'Mật khẩu đạt chuẩn an toàn cho tài khoản hệ thống thông tin nội bộ nên đáp ứng yêu cầu nào?',
        options: [
          'Ngắn gọn 4 chữ số trùng với năm sinh để dễ nhớ',
          'Đặt giống tên đăng nhập hoặc tên đơn vị',
          'Đủ độ dài tối thiểu, kết hợp chữ hoa, chữ thường, chữ số và ký tự đặc biệt',
          'Ghi trực tiếp ra giấy dán trên màn hình máy tính trực ban',
        ],
        correctIndex: 2,
        explanation:
          'Mật khẩu mạnh cần kết hợp nhiều loại ký tự (hoa, thường, số, ký tự đặc biệt), không trùng thông tin cá nhân dễ đoán và không ghi công khai.',
      },
      {
        id: 'q-ths-6',
        text: 'Đuôi tệp tin mặc định của văn bản Microsoft Word phiên bản từ 2007 trở lên là gì?',
        options: ['.xlsx', '.docx', '.pptx', '.pdf'],
        correctIndex: 1,
        explanation:
          '.docx là định dạng chuẩn Open XML của Microsoft Word; .xlsx của Excel, .pptx của PowerPoint và .pdf là định dạng tài liệu di động.',
      },
      {
        id: 'q-ths-7',
        text: 'Khi nhận được thư điện tử hoặc liên kết lạ nghi ngờ giả mạo yêu cầu nhập mật khẩu công vụ, quân nhân cần làm gì?',
        options: [
          'Nhấp vào liên kết để kiểm tra xem nội dung bên trong có đúng không',
          'Chuyển tiếp thư đó cho toàn bộ đồng đội trong đại đội cùng xem',
          'Không nhấp vào liên kết, không cung cấp thông tin và báo cáo ngay cho cán bộ phụ trách CNTT/bảo mật',
          'Nhập thử một mật khẩu phụ để kiểm tra trang web',
        ],
        correctIndex: 2,
        explanation:
          'Tuyệt đối không truy cập liên kết đáng ngờ hoặc cung cấp thông tin xác thực; cần báo ngay cho lực lượng phụ trách an toàn thông tin của đơn vị.',
      },
      {
        id: 'q-ths-8',
        text: 'Phím tắt nào dùng để chuyển đổi nhanh giữa các cửa sổ ứng dụng đang mở trên Windows?',
        options: ['Alt + Tab', 'Ctrl + Shift + Esc', 'Windows + L', 'Alt + F4'],
        correctIndex: 0,
        explanation:
          'Alt + Tab chuyển nhanh giữa các cửa sổ; Windows + L khóa màn hình máy tính; Alt + F4 đóng cửa sổ hiện tại.',
      },
      {
        id: 'q-ths-9',
        text: 'Trong Excel, địa chỉ ô nào là địa chỉ tuyệt đối cả cột và hàng?',
        options: ['A1', '$A1', 'A$1', '$A$1'],
        correctIndex: 3,
        explanation:
          'Ký hiệu $ đứng trước cả tên cột và số hàng ($A$1) cố định hoàn toàn tọa độ ô khi sao chép công thức.',
      },
      {
        id: 'q-ths-10',
        text: 'Hành động nào giúp bảo vệ máy tính khi cán bộ rời khỏi bàn làm việc trong thời gian ngắn?',
        options: [
          'Để nguyên màn hình đăng nhập hệ thống cho tiện thao tác khi quay lại',
          'Khóa màn hình nhanh bằng tổ hợp phím Windows + L',
          'Rút dây nguồn máy tính đột ngột không cần tắt máy',
          'Chỉ tắt màn hình nhưng vẫn giữ nguyên phiên đăng nhập',
        ],
        correctIndex: 1,
        explanation:
          'Windows + L khóa ngay phiên làm việc mà vẫn giữ nguyên các phần mềm đang chạy an toàn, ngăn người không có thẩm quyền truy cập.',
      },
    ],
  },
  {
    id: 'topic-lu-doan-490',
    code: 'CD-02',
    title: 'Truyền thống Lữ đoàn Tên lửa 490 & Tiểu đoàn 3',
    description:
      'Tìm hiểu lịch sử xây dựng, chiến đấu, trưởng thành, nhiệm vụ chính trị trọng tâm và truyền thống vẻ vang của Lữ đoàn Tên lửa 490 - Binh chủng Pháo binh.',
    timeLimitMinutes: 15,
    createdAt: '2026-01-12T08:00:00.000Z',
    updatedAt: '2026-01-12T08:00:00.000Z',
    questions: [
      {
        id: 'q-ld-1',
        text: 'Truyền thống vẻ vang của Bộ đội Pháo binh Việt Nam được Chủ tịch Hồ Chí Minh tặng 8 chữ vàng nào?',
        options: [
          'Trung với nước, hiếu với dân',
          'Chân đồng vai sắt, đánh giỏi, bắn trúng',
          'Quyết chiến, quyết thắng',
          'Đoàn kết, kỷ luật, sáng tạo, thắng lợi',
        ],
        correctIndex: 1,
        explanation:
          'Ngày 13/4/1967, Bác Hồ gửi thư khen và tặng Bộ đội Pháo binh 8 chữ vàng: "Chân đồng vai sắt, đánh giỏi, bắn trúng".',
      },
      {
        id: 'q-ld-2',
        text: 'Lữ đoàn Tên lửa 490 trực thuộc Binh chủng nào trong Quân đội nhân dân Việt Nam?',
        options: [
          'Quân chủng Phòng không - Không quân',
          'Binh chủng Pháo binh',
          'Binh chủng Tăng thiết giáp',
          'Binh chủng Thông tin liên lạc',
        ],
        correctIndex: 1,
        explanation:
          'Lữ đoàn Tên lửa 490 là đơn vị tên lửa chiến thuật - chiến dịch nòng cốt trực thuộc Binh chủng Pháo binh.',
      },
      {
        id: 'q-ld-3',
        text: 'Trong huấn luyện sẵn sàng chiến đấu ở Tiểu đoàn 3, yêu cầu "3 thực chất" gồm những nội dung nào?',
        options: [
          'Dạy thực chất, học thực chất, kiểm tra đánh giá kết quả thực chất',
          'Ăn thực chất, ở thực chất, hành quân thực chất',
          'Báo cáo thực chất, họp thực chất, nghỉ ngơi thực chất',
          'Trang bị thực chất, kho tàng thực chất, doanh trại thực chất',
        ],
        correctIndex: 0,
        explanation:
          'Phương châm nâng cao chất lượng huấn luyện nhấn mạnh "3 thực chất": Dạy thực chất, học thực chất, kiểm tra đánh giá kết quả thực chất.',
      },
      {
        id: 'q-ld-4',
        text: 'Khẩu hiệu thi đua tiêu biểu của Tiểu đoàn 3 trong học tập và rèn luyện là gì?',
        options: [
          'Nhanh nhẹn, linh hoạt, an toàn tuyệt đối',
          'Tích cực, chủ động, tiến bộ toàn diện',
          'Chính quy, tinh nhuệ, hiện đại',
          'Vượt nắng thắng mưa, say sưa luyện tập',
        ],
        correctIndex: 1,
        explanation:
          'Khẩu hiệu hành động của Tiểu đoàn 3 là "Tích cực, chủ động, tiến bộ toàn diện".',
      },
      {
        id: 'q-ld-5',
        text: 'Phương châm huấn luyện cơ bản của Quân đội ta đối với lực lượng thường trực là gì?',
        options: [
          'Cơ bản, thiết thực, vững chắc',
          'Cơ bản, thiết thực, chất lượng',
          'Nhanh, mạnh, chính xác, bí mật',
          'Đồng bộ, chuyên sâu, tinh gọn',
        ],
        correctIndex: 0,
        explanation:
          'Phương châm huấn luyện của Quân đội nhân dân Việt Nam là "Cơ bản, thiết thực, vững chắc".',
      },
      {
        id: 'q-ld-6',
        text: 'Ngày truyền thống của Bộ đội Pháo binh Việt Nam là ngày nào?',
        options: ['19/12/1946', '29/06/1946', '22/12/1944', '03/03/1959'],
        correctIndex: 1,
        explanation:
          'Ngày 29/6/1946 là Ngày truyền thống vẻ vang của Bộ đội Pháo binh Việt Nam anh hùng.',
      },
      {
        id: 'q-ld-7',
        text: 'Trong công tác bảo quản vũ khí trang bị kỹ thuật (VKTBKT) tên lửa, "Ngày kỹ thuật" hàng tuần nhằm mục đích chính gì?',
        options: [
          'Thay mới toàn bộ khí tài định kỳ',
          'Kiểm tra, bảo dưỡng, lau chùi, phát hiện và khắc phục kịp thời hư hỏng để giữ hệ số kỹ thuật cao',
          'Chỉ vệ sinh khu vực nhà xe bên ngoài',
          'Cất niêm cất toàn bộ phương tiện không kiểm tra',
        ],
        correctIndex: 1,
        explanation:
          'Ngày kỹ thuật nhằm duy trì đồng bộ, kiểm tra tình trạng kỹ thuật, bảo quản, bảo dưỡng giúp VKTBKT luôn sẵn sàng chiến đấu cao.',
      },
      {
        id: 'q-ld-8',
        text: 'Bản chất, truyền thống tốt đẹp nhất của người quân nhân cách mạng được thể hiện cô đọng qua danh hiệu nào?',
        options: [
          'Chiến sĩ thi đua',
          'Bộ đội Cụ Hồ',
          'Đơn vị Quyết thắng',
          'Dũng sĩ diệt máy bay',
        ],
        correctIndex: 1,
        explanation:
          'Phẩm chất "Bộ đội Cụ Hồ" là giá trị cốt lõi, truyền thống cao đẹp kết tinh qua các thế hệ cán bộ, chiến sĩ Quân đội nhân dân Việt Nam.',
      },
    ],
  },
  {
    id: 'topic-dieu-lenh-cds',
    code: 'CD-03',
    title: 'Điều lệnh quản lý bộ đội & Chuyển đổi số',
    description:
      'Nội dung cơ bản về 10 lời thề danh dự, 12 điều kỷ luật, chế độ ngày/tuần và ứng dụng công nghệ số trong công tác huấn luyện tại đơn vị.',
    timeLimitMinutes: 12,
    createdAt: '2026-01-15T08:00:00.000Z',
    updatedAt: '2026-01-15T08:00:00.000Z',
    questions: [
      {
        id: 'q-dl-1',
        text: 'Theo Điều lệnh quản lý bộ đội, trong một ngày làm việc, đơn vị phải duy trì đầy đủ bao nhiêu chế độ?',
        options: ['9 chế độ trong ngày', '10 chế độ trong ngày', '11 chế độ trong ngày', '12 chế độ trong ngày'],
        correctIndex: 2,
        explanation:
          'Điều lệnh quản lý bộ đội quy định 11 chế độ trong ngày từ treo Quốc kỳ, thức dậy, thể dục sáng đến điểm danh, kiểm tra nội vụ và ngủ nghỉ.',
      },
      {
        id: 'q-dl-2',
        text: 'Trong 1 tuần học tập công tác, đơn vị thực hiện bao nhiêu chế độ trong tuần?',
        options: ['2 chế độ', '3 chế độ', '4 chế độ', '5 chế độ'],
        correctIndex: 1,
        explanation:
          '3 chế độ trong tuần gồm: Chào cờ duyệt đội ngũ, Thông báo chính trị và Tổng vệ sinh doanh trại.',
      },
      {
        id: 'q-dl-3',
        text: 'Lời thề thứ nhất trong 10 Lời thề danh dự của quân nhân nhấn mạnh điều gì?',
        options: [
          'Tuyệt đối phục tùng mệnh lệnh cấp trên',
          'Hy sinh tất cả vì Tổ quốc Việt Nam xã hội chủ nghĩa, dưới sự lãnh đạo của Đảng Cộng sản Việt Nam',
          'Ra sức học tập nâng cao trình độ chính trị, quân sự',
          'Giữ gìn vũ khí trang bị và của công',
        ],
        correctIndex: 1,
        explanation:
          'Lời thề thứ nhất khẳng định lòng trung thành tuyệt đối với Tổ quốc, Đảng và Nhân dân.',
      },
      {
        id: 'q-dl-4',
        text: 'Ứng dụng hệ thống thi trắc nghiệm số trong ôn luyện kiến thức giúp ích trực tiếp gì cho Tiểu đoàn?',
        options: [
          'Thay thế hoàn toàn huấn luyện thực hành ngoài bãi tập',
          'Chuẩn hóa ngân hàng câu hỏi, tự động chấm điểm khách quan và lưu trữ hồ sơ tiến bộ của từng quân nhân',
          'Giảm thời gian sinh hoạt chính trị xuống 0 phút',
          'Chỉ sử dụng cho cán bộ chỉ huy các cấp',
        ],
        correctIndex: 1,
        explanation:
          'Tin học số giúp chuẩn hóa đề thi, chấm điểm khách quan, minh bạch theo thang điểm 10 và theo dõi lịch sử rèn luyện của từng quân nhân.',
      },
      {
        id: 'q-dl-5',
        text: 'Khi thực hiện động tác chào bằng tay (không có súng), bàn tay phải đặt như thế nào?',
        options: [
          'Ngón giữa chạm vào bên phải vành mũ ngang với đuôi lông mày phải',
          'Ngón trỏ đặt ở giữa trán',
          'Lòng bàn tay hướng thẳng ra phía trước',
          'Khép các ngón tay đặt ngang ngực trái',
        ],
        correctIndex: 0,
        explanation:
          'Theo Điều lệnh Đội ngũ, đầu ngón tay giữa đặt chạm vào bên phải vành mũ (hoặc ngang đuôi lông mày phải nếu không đội mũ), các ngón khép kín.',
      },
      {
        id: 'q-dl-6',
        text: 'Quân nhân khi báo cáo với cấp trên trực tiếp cần thực hiện trình tự nào?',
        options: [
          'Đứng nghiêm, chào theo điều lệnh, xưng hô "Báo cáo đồng chí..." rồi trình bày ngắn gọn, rõ ràng',
          'Ngồi tại chỗ giơ tay phát biểu ngay',
          'Gửi tin nhắn thay cho báo cáo trực tiếp khi đang trong đội hình',
          'Trình bày xong mới đứng dậy chào',
        ],
        correctIndex: 0,
        explanation:
          'Tác phong báo cáo đúng điều lệnh thể hiện tính chính quy, kỷ luật và tôn trọng cấp trên.',
      },
    ],
  },
];

export const DEFAULT_ATTEMPTS: QuizAttempt[] = [
  {
    id: 'att-seed-1',
    accountUsername: 'hocvien01',
    candidateName: 'Nguyễn Văn Phong',
    unitName: 'Đại đội 7 - Tiểu đoàn 3',
    topicId: 'topic-tin-hoc-so',
    topicTitle: 'Tin học văn phòng & An toàn thông tin số',
    answers: {},
    correctCount: 9,
    totalCount: 10,
    score10: 9,
    grade: 'Giỏi',
    durationSeconds: 215,
    startedAt: '2026-11-16T07:30:00.000Z',
    submittedAt: '2026-11-16T07:33:35.000Z',
  },
  {
    id: 'att-seed-2',
    accountUsername: 'hocvien01',
    candidateName: 'Nguyễn Văn Phong',
    unitName: 'Đại đội 7 - Tiểu đoàn 3',
    topicId: 'topic-lu-doan-490',
    topicTitle: 'Truyền thống Lữ đoàn Tên lửa 490 & Tiểu đoàn 3',
    answers: {},
    correctCount: 6,
    totalCount: 8,
    score10: 7.5,
    grade: 'Khá',
    durationSeconds: 184,
    startedAt: '2026-11-17T08:15:00.000Z',
    submittedAt: '2026-11-17T08:18:04.000Z',
  },
  {
    id: 'att-seed-3',
    accountUsername: 'hocvien01',
    candidateName: 'Nguyễn Văn Phong',
    unitName: 'Đại đội 7 - Tiểu đoàn 3',
    topicId: 'topic-dieu-lenh-cds',
    topicTitle: 'Điều lệnh quản lý bộ đội & Chuyển đổi số',
    answers: {},
    correctCount: 6,
    totalCount: 6,
    score10: 10,
    grade: 'Giỏi',
    durationSeconds: 142,
    startedAt: '2026-11-18T02:00:00.000Z',
    submittedAt: '2026-11-18T02:02:22.000Z',
  },
  {
    id: 'att-seed-4',
    accountUsername: 'hocvien01',
    candidateName: 'Trần Thanh Tùng',
    unitName: 'Đại đội 7 - Tiểu đoàn 3',
    topicId: 'topic-tin-hoc-so',
    topicTitle: 'Tin học văn phòng & An toàn thông tin số',
    answers: {},
    correctCount: 8,
    totalCount: 10,
    score10: 8,
    grade: 'Giỏi',
    durationSeconds: 260,
    startedAt: '2026-11-17T09:00:00.000Z',
    submittedAt: '2026-11-17T09:04:20.000Z',
  },
  {
    id: 'att-seed-5',
    accountUsername: 'hocvien01',
    candidateName: 'Lê Hoàng Lâm',
    unitName: 'Đại đội 7 - Tiểu đoàn 3',
    topicId: 'topic-lu-doan-490',
    topicTitle: 'Truyền thống Lữ đoàn Tên lửa 490 & Tiểu đoàn 3',
    answers: {},
    correctCount: 5,
    totalCount: 8,
    score10: 6.3,
    grade: 'Đạt',
    durationSeconds: 245,
    startedAt: '2026-11-17T14:10:00.000Z',
    submittedAt: '2026-11-17T14:14:05.000Z',
  },
  {
    id: 'att-seed-6',
    accountUsername: 'hocvien02',
    candidateName: 'Phạm Minh Tuấn',
    unitName: 'Đại đội 8 - Tiểu đoàn 3',
    topicId: 'topic-tin-hoc-so',
    topicTitle: 'Tin học văn phòng & An toàn thông tin số',
    answers: {},
    correctCount: 4,
    totalCount: 10,
    score10: 4,
    grade: 'Yếu',
    durationSeconds: 310,
    startedAt: '2026-11-18T01:20:00.000Z',
    submittedAt: '2026-11-18T01:25:10.000Z',
  },
];
