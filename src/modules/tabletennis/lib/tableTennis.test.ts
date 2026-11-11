import {
  cleanAverages,
  cleanStandings,
  LEAGUES,
  mainRecords,
  pickCompetition,
  searchPlayers,
  winRate,
} from '../../../../supabase/functions/_shared/tableTennis.ts'

const TIM = '683d31a7-ebf8-4730-b252-fbbf404544be'
const row = (over: Record<string, unknown> = {}) => ({
  userId: TIM, name: 'Timothy Denby', division: 'Division 1', teamFullName: 'Graham Spicer A', club: 'Graham Spicer TTC', played: 18, won: 17, loss: 1, ...over,
})

describe('table tennis leagues', () => {
  it('picks the newest season, never a cup', () => {
    const sutton = LEAGUES.find((l) => l.key === 'sutton')!
    expect(pickCompetition([{ id: 4982, name: 'Handicap Cup 26-27' }, { id: 4979, name: 'Knock out cup 26-27' }, { id: 4624, name: 'Season 26-27' }, { id: 3000, name: 'Season 25-26' }], sutton))
      .toEqual({ id: 4624, name: 'Season 26-27' })
    const british = LEAGUES.find((l) => l.key === 'british')!
    expect(pickCompetition([{ id: 4527, name: 'Senior British Club League 2026-27' }, { id: 4645, name: 'Youth British Club League (Boys open) 2026-27' }], british)?.id).toBe(4527)
    expect(pickCompetition('nope', british)).toBeNull()
  })

  it('keeps only averages with a real player id and plain text', () => {
    const rows = cleanAverages([row(), row({ userId: 'not-an-id' }), row({ name: '  ' }), null], 'sutton', 13138)
    expect(rows).toEqual([{ league: 'sutton', ttUserId: TIM, name: 'Timothy Denby', division: 'Division 1', divisionId: 13138, team: 'Graham Spicer A', club: 'Graham Spicer TTC', played: 18, won: 17, lost: 1 }])
  })

  it('uses the team a player has played most for in each league', () => {
    const rows = [
      ...cleanAverages([row({ teamFullName: 'Graham Spicer B', played: 3, won: 3, loss: 0 }), row()], 'sutton', 1),
      ...cleanAverages([row({ teamFullName: 'Colin Deaton', played: 14, won: 7, loss: 7 })], 'british', 2),
    ]
    expect(mainRecords(rows, TIM.toUpperCase()).map((r) => `${r.league} ${r.team} ${r.won}-${r.lost}`)).toEqual(['sutton Graham Spicer A 17-1', 'british Colin Deaton 7-7'])
  })

  it('drops byes from the league table and sorts it', () => {
    expect(cleanStandings([{ position: 2, name: 'B', played: 5, won: 3, drawn: 0, lost: 2, points: 6 }, { position: 9, name: 'BYE 1' }, { position: 1, fullName: 'A', played: 5, won: 4, drawn: 0, lost: 1, points: 8 }]).map((s) => s.team))
      .toEqual(['A', 'B'])
  })

  it('finds a player by every word of their name, once, with where they play', () => {
    const rows = [...cleanAverages([row()], 'sutton', 1), ...cleanAverages([row({ teamFullName: 'Colin Deaton' })], 'british', 2), ...cleanAverages([row({ userId: '00000000-0000-4000-8000-000000000000', name: 'Tim Smith' })], 'sutton', 1)]
    expect(searchPlayers(rows, 'tim denby')).toEqual([{ ttUserId: TIM, name: 'Timothy Denby', where: ['Sutton & District · Graham Spicer A', 'British League · Colin Deaton'] }])
    expect(searchPlayers(rows, 'x')).toEqual([])
  })

  it('works out a win rate only once games are played', () => {
    expect(winRate(17, 18)).toBe(94)
    expect(winRate(0, 0)).toBeNull()
  })
})
