export const config = {
  farmName: process.env.NEXT_PUBLIC_FARM_NAME || '우리 농장',
  bankInfo: process.env.NEXT_PUBLIC_BANK_INFO || '[은행] [계좌번호] ([예금주])',
  retention: process.env.NEXT_PUBLIC_PRIVACY_RETENTION || '발송 완료 후 6개월',
  senderAddress: process.env.NEXT_PUBLIC_SENDER_ADDRESS || '',
};

export const STATUSES = ['입금대기', '입금확인', '발송중', '발송완료'];
export const LOTTE_TRACKING_URL = 'https://www.lotteglogis.com/home/reservation/tracking/index';
