import {
  normalizeText,
  isCorrectGuess,
  pickRandomWords,
  PRESET_WORDS,
} from '../drawGuessUtils';

describe('drawGuessUtils 判词', () => {
  test('normalizeText 去空格标点并转小写', () => {
    expect(normalizeText(' 苹 果，。!')).toBe('苹果');
    expect(normalizeText('Cat, Dog')).toBe('catdog');
    expect(normalizeText('')).toBe('');
    expect(normalizeText(null)).toBe('');
  });

  test('精确匹配判对', () => {
    expect(isCorrectGuess('苹果', '苹果')).toBe(true);
    expect(isCorrectGuess(' 苹果！', '苹果')).toBe(true);
  });

  test('单字/无关猜测判错', () => {
    expect(isCorrectGuess('果', '苹果')).toBe(false);
    expect(isCorrectGuess('香蕉', '苹果')).toBe(false);
    expect(isCorrectGuess('', '苹果')).toBe(false);
  });

  test('长度差 ≤1 的包含关系判对（容错）', () => {
    expect(isCorrectGuess('哆啦A梦', '哆啦A梦')).toBe(true);
    // 猜测比答案少一个字且包含于答案
    expect(isCorrectGuess('多拉A梦', '哆啦A梦')).toBe(false); // 不同的字不算包含
    expect(isCorrectGuess('西瓜', '大西瓜')).toBe(true);
  });

  test('pickRandomWords 返回不重复的 n 个词', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99); // 不混入自定义词
    const words = pickRandomWords(['我们的暗号'], 3);
    expect(words.length).toBe(3);
    expect(new Set(words).size).toBe(3);
    words.forEach((w) => expect(PRESET_WORDS).toContain(w));
  });

  test('pickRandomWords 可混入自定义词', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1); // 触发混入
    const words = pickRandomWords(['小笼包'], 3);
    expect(words).toContain('小笼包');
    expect(new Set(words).size).toBe(3);
  });
});
