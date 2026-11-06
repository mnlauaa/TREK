import type { TranslationStrings } from '../types';

const system_notice: TranslationStrings = {
  'system_notice.v3_photos.title': '3.0 versiyasında fotoların yeri dəyişib',
  'system_notice.v3_photos.body':
    '**Fotolar** bölməsi Səyahət planlayıcısından silinib. Fotolarınız təhlükəsizdir — TREK Immich və ya Synology kitabxananızı heç vaxt dəyişdirməyib.\n\nFotolar indi **Səyahət gündəliyi** əlavəsində yerləşir. Səyahət gündəliyi istəyə bağlıdır — hələ mövcud deyilsə, administratorunuzdan onu İdarəetmə → Əlavələr bölməsində aktivləşdirməsini istəyin.',
  'system_notice.v3_journey.title': 'Səyahət gündəliyi ilə tanış olun',
  'system_notice.v3_journey.body':
    'Səyahətlərinizi zaman xətləri, foto qalereyaları və interaktiv xəritələrlə zəngin səyahət hekayələri kimi sənədləşdirin.',
  'system_notice.v3_journey.cta_label': 'Səyahət gündəliyini aç',
  'system_notice.v3_journey.highlight_timeline': 'Günbəgün zaman xətti və qalereya',
  'system_notice.v3_journey.highlight_photos': 'Immich və ya Synology-dən idxal',
  'system_notice.v3_journey.highlight_share': 'Açıq paylaşın — giriş tələb olunmur',
  'system_notice.v3_journey.highlight_export': 'PDF foto kitabı kimi ixrac edin',
  'system_notice.v3_features.title': '3.0 versiyasındakı digər yeniliklər',
  'system_notice.v3_features.body': 'Bu buraxılış haqqında bilməyə dəyər daha bir neçə yenilik.',
  'system_notice.v3_features.highlight_dashboard': 'Mobil cihazlara üstünlük verən yenilənmiş idarə paneli',
  'system_notice.v3_features.highlight_offline': 'PWA kimi tam oflayn rejim',
  'system_notice.v3_features.highlight_search': 'Real vaxt rejimində məkan axtarışının avtomatik tamamlanması',
  'system_notice.v3_features.highlight_import': 'KMZ/KML fayllarından məkan idxalı',
  'system_notice.v3_mcp.title': 'MCP: OAuth 2.1 yeniləməsi',
  'system_notice.v3_mcp.body':
    'MCP inteqrasiyası tamamilə yenilənib. OAuth 2.1 indi tövsiyə edilən doğrulama üsuludur. Köhnə statik tokenlər (trek_…) artıq tövsiyə edilmir və gələcək buraxılışda silinəcək.',
  'system_notice.v3_mcp.highlight_oauth': 'OAuth 2.1 tövsiyə edilir (mcp-remote)',
  'system_notice.v3_mcp.highlight_scopes': '24 dəqiq tənzimlənən icazə sahəsi',
  'system_notice.v3_mcp.highlight_deprecated': 'Statik trek_ tokenləri artıq tövsiyə edilmir',
  'system_notice.v3_mcp.highlight_tools': 'Genişləndirilmiş alətlər və sorğular',
  'system_notice.v3_thankyou.title': 'Məndən şəxsi bir qeyd',
  'system_notice.v3_thankyou.body':
    'Getməzdən əvvəl bir anlıq dayanmaq istəyirəm.\n\nTREK öz səyahətlərim üçün hazırladığım kiçik əlavə layihə kimi başladı. Onun böyüyərək macəralarını planlaşdırmaq üçün indi 4 000 nəfərin etibar etdiyi bir layihəyə çevriləcəyini heç vaxt təsəvvür etməzdim. Hər ulduzu, hər problem bildirişini və hər funksiya təklifini oxuyuram. Onlar tam iş günü və universitet arasında gecə saatlarında işləməyə davam etməyimə kömək edir.\n\nBunu bilməyinizi istəyirəm: TREK həmişə açıq mənbəli, həmişə şəxsi serverinizdə işləyən və həmişə sizə məxsus olacaq. İzləmə, abunəlik və gizli şərt yoxdur. Sadəcə səyahəti sizin qədər sevən birinin hazırladığı alətdir.\n\n[jubnl](https://github.com/jubnl) üçün xüsusi təşəkkür — inanılmaz əməkdaş oldunuz. 3.0 versiyasını möhtəşəm edən xüsusiyyətlərin çoxunda sizin iziniz var. Layihə hələ tam hazır olmadığı vaxtda ona inandığınız üçün təşəkkür edirəm.\n\nXəta bildirən, bir sətri tərcümə edən, TREK-i dostu ilə paylaşan və ya sadəcə səyahət planlaşdırmaq üçün istifadə edən hər birinizə — **təşəkkür edirəm**. Bunun mövcud olmasının səbəbi sizsiniz.\n\nBirlikdə daha çox macəralara.\n\n— Maurice\n\n---\n\n[Discord icmasına qoşulun](https://discord.gg/7Q6M6jDwzf)\n\nTREK səyahətlərinizi yaxşılaşdırırsa, [kiçik bir qəhvə](https://ko-fi.com/mauriceboe) layihənin davam etməsinə həmişə kömək edir.',
  'system_notice.v3014_whitespace_collision.title': 'Əməliyyat tələb olunur: istifadəçi hesabı ziddiyyəti',
  'system_notice.v3014_whitespace_collision.body':
    '3.0.14 yeniləməsi saxlanılan hesablardakı adların əvvəlində və ya sonunda olan boşluqların yaratdığı bir və ya daha çox istifadəçi adı və ya e-poçt ziddiyyəti aşkarladı. Təsirlənmiş hesabların adları avtomatik dəyişdirildi. Hansı hesabların yoxlanılmalı olduğunu müəyyən etmək üçün server jurnallarında **[migration] WHITESPACE COLLISION** ilə başlayan sətirləri yoxlayın.',
  'system_notice.welcome_v1.title': 'TREK-ə xoş gəlmisiniz',
  'system_notice.welcome_v1.body':
    'Hamısı birində səyahət planlayıcınız. Marşrutlar yaradın, səyahətləri dostlarınızla paylaşın və onlayn və ya oflayn rejimdə planlı qalın.',
  'system_notice.welcome_v1.cta_label': 'Səyahət planlaşdır',
  'system_notice.welcome_v1.hero_alt': 'TREK planlaşdırma interfeysinin göstərildiyi mənzərəli səyahət məkanı',
  'system_notice.welcome_v1.highlight_plan': 'İstənilən səyahət üçün günbəgün marşrutlar',
  'system_notice.welcome_v1.highlight_share': 'Səyahət yoldaşlarınızla əməkdaşlıq edin',
  'system_notice.welcome_v1.highlight_offline': 'Mobil cihazlarda oflayn işləyir',
  'system_notice.dev_test_modal.title': '[Tərtibat] Sınaq bildirişi',
  'system_notice.dev_test_modal.body': 'Bu, yalnız tərtibat üçün olan sınaq bildirişidir.',

  'system_notice.pager.prev': 'Əvvəlki bildiriş',
  'system_notice.pager.next': 'Növbəti bildiriş',
  'system_notice.pager.counter': '{current} / {total}',
  'system_notice.pager.goto': '{n}-ci bildirişə keç',
  'system_notice.pager.position': '{total} bildirişdən {current}-cisi',
};

export default system_notice;
