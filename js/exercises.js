'use strict';

// 部位
const PARTS = [
  { id: 'chest', name: '胸', color: '#ff6b6b' },
  { id: 'back', name: '背中', color: '#4dabf7' },
  { id: 'shoulders', name: '肩', color: '#ffd43b' },
  { id: 'legs', name: '脚', color: '#69db7c' },
  { id: 'arms', name: '腕', color: '#da77f2' },
  { id: 'abs', name: '腹筋', color: '#ffa94d' },
  { id: 'cardio', name: '有酸素', color: '#38d9a9' },
];

const EQUIPMENT = ['バーベル', 'ダンベル', 'マシン', 'ケーブル', '自重', 'その他'];

// 記録タイプ: wr=重量×回数, r=回数のみ, t=時間(秒), c=有酸素(分・km)
const DEFAULT_EXERCISES = [
  // 胸
  ['bench_press', 'ベンチプレス', 'chest', 'バーベル'],
  ['incline_bench', 'インクラインベンチプレス', 'chest', 'バーベル'],
  ['decline_bench', 'デクラインベンチプレス', 'chest', 'バーベル'],
  ['db_press', 'ダンベルプレス', 'chest', 'ダンベル'],
  ['incline_db_press', 'インクラインダンベルプレス', 'chest', 'ダンベル'],
  ['db_fly', 'ダンベルフライ', 'chest', 'ダンベル'],
  ['chest_press', 'チェストプレス', 'chest', 'マシン'],
  ['pec_fly', 'ペックフライ', 'chest', 'マシン'],
  ['cable_crossover', 'ケーブルクロスオーバー', 'chest', 'ケーブル'],
  ['push_up', '腕立て伏せ', 'chest', '自重', 'r'],
  ['dips', 'ディップス', 'chest', '自重', 'r'],
  // 背中
  ['deadlift', 'デッドリフト', 'back', 'バーベル'],
  ['bent_over_row', 'ベントオーバーロウ', 'back', 'バーベル'],
  ['t_bar_row', 'Tバーロウ', 'back', 'バーベル'],
  ['one_arm_row', 'ワンハンドダンベルロウ', 'back', 'ダンベル'],
  ['pull_up', '懸垂', 'back', '自重', 'r'],
  ['lat_pulldown', 'ラットプルダウン', 'back', 'マシン'],
  ['seated_row', 'シーテッドロウ', 'back', 'ケーブル'],
  ['back_extension', 'バックエクステンション', 'back', '自重', 'r'],
  ['shrug', 'シュラッグ', 'back', 'ダンベル'],
  // 肩
  ['ohp', 'オーバーヘッドプレス', 'shoulders', 'バーベル'],
  ['db_shoulder_press', 'ダンベルショルダープレス', 'shoulders', 'ダンベル'],
  ['machine_shoulder_press', 'ショルダープレス', 'shoulders', 'マシン'],
  ['side_raise', 'サイドレイズ', 'shoulders', 'ダンベル'],
  ['front_raise', 'フロントレイズ', 'shoulders', 'ダンベル'],
  ['rear_raise', 'リアレイズ', 'shoulders', 'ダンベル'],
  ['face_pull', 'フェイスプル', 'shoulders', 'ケーブル'],
  ['upright_row', 'アップライトロウ', 'shoulders', 'バーベル'],
  // 脚
  ['squat', 'スクワット', 'legs', 'バーベル'],
  ['front_squat', 'フロントスクワット', 'legs', 'バーベル'],
  ['leg_press', 'レッグプレス', 'legs', 'マシン'],
  ['rdl', 'ルーマニアンデッドリフト', 'legs', 'バーベル'],
  ['bulgarian_squat', 'ブルガリアンスクワット', 'legs', 'ダンベル'],
  ['lunge', 'ランジ', 'legs', 'ダンベル'],
  ['leg_extension', 'レッグエクステンション', 'legs', 'マシン'],
  ['leg_curl', 'レッグカール', 'legs', 'マシン'],
  ['hip_thrust', 'ヒップスラスト', 'legs', 'バーベル'],
  ['calf_raise', 'カーフレイズ', 'legs', 'マシン'],
  // 腕
  ['barbell_curl', 'バーベルカール', 'arms', 'バーベル'],
  ['db_curl', 'ダンベルカール', 'arms', 'ダンベル'],
  ['hammer_curl', 'ハンマーカール', 'arms', 'ダンベル'],
  ['preacher_curl', 'プリーチャーカール', 'arms', 'マシン'],
  ['pushdown', 'トライセプスプッシュダウン', 'arms', 'ケーブル'],
  ['french_press', 'フレンチプレス', 'arms', 'ダンベル'],
  ['skull_crusher', 'ライイングトライセプスエクステンション', 'arms', 'バーベル'],
  ['close_grip_bench', 'ナローベンチプレス', 'arms', 'バーベル'],
  ['kickback', 'キックバック', 'arms', 'ダンベル'],
  // 腹筋
  ['crunch', 'クランチ', 'abs', '自重', 'r'],
  ['leg_raise', 'レッグレイズ', 'abs', '自重', 'r'],
  ['ab_roller', 'アブローラー', 'abs', 'その他', 'r'],
  ['russian_twist', 'ロシアンツイスト', 'abs', '自重', 'r'],
  ['cable_crunch', 'ケーブルクランチ', 'abs', 'ケーブル'],
  ['plank', 'プランク', 'abs', '自重', 't'],
  // 有酸素
  ['running', 'ランニング', 'cardio', 'その他', 'c'],
  ['treadmill', 'トレッドミル', 'cardio', 'マシン', 'c'],
  ['bike', 'エアロバイク', 'cardio', 'マシン', 'c'],
  ['walking', 'ウォーキング', 'cardio', 'その他', 'c'],
].map(([id, name, part, eq, type = 'wr']) => ({ id, name, part, eq, type }));
