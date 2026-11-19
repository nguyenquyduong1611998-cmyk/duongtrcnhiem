import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Đã xảy ra sự cố không mong muốn trong quá trình xử lý dữ liệu.',
    };
  }

  componentDidCatch(error: Error) {
    console.error('Application ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      let friendlyMessage =
        'Hệ thống gặp lỗi khi kết nối hoặc xử lý dữ liệu. Vui lòng tải lại trang để tiếp tục.';
      if (this.state.message.includes('Quota exceeded')) {
        friendlyMessage =
          'Hạn mức truy cập cơ sở dữ liệu hôm nay đã hết và sẽ tự đặt lại vào ngày mai.';
      } else if (this.state.message.includes('Missing or insufficient permissions')) {
        friendlyMessage =
          'Tài khoản hiện tại không đủ quyền thực hiện thao tác cơ sở dữ liệu này.';
      }

      return (
        <div className="min-h-screen bg-[#F4F6F4] flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-[#DDE3DC] rounded-xl p-6 text-center space-y-4 shadow-sm">
            <div className="w-12 h-12 rounded-lg bg-[#FEF2F2] text-[#B91C1C] flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-lg font-bold text-[#152019]">
                Thông báo sự cố dữ liệu
              </h1>
              <p className="text-sm text-[#4B5B50] leading-relaxed">{friendlyMessage}</p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#1F4D36] hover:bg-[#173B29] text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Tải lại ứng dụng</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
