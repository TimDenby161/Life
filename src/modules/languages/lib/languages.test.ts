import { studyPartOf } from './languages'

describe('studyPartOf', () => {
  it('recognises language tasks by title and category', () => {
    expect(studyPartOf('Learn two Spanish words')).toEqual({ language: 'es', part: 'word' })
    expect(studyPartOf('Learn 3 new words', 'Mandarin')).toEqual({ language: 'zh', part: 'word' })
    expect(studyPartOf('Learn 2 characters', 'Mandarin')).toEqual({ language: 'zh', part: 'character' })
    expect(studyPartOf('Spanish review')).toEqual({ language: 'es', part: 'review' })
  })

  it('leaves other tasks alone', () => {
    expect(studyPartOf('Bins out')).toBeNull()
    expect(studyPartOf('Book Spanish lesson')).toBeNull()
    // Spanish has no characters to learn.
    expect(studyPartOf('Spanish characters')).toBeNull()
  })
})
