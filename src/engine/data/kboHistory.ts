// 실제 KBO 구단 역사(2025 시즌까지, D-082). scripts/import-kbo-history.mjs로 생성 — 직접 고치지 않는다.
// 구단은 게임 구단 ID로만 구분하고, 선수 이름은 모두 가상 이름으로 바꿨다. 숫자 기록은 조사 자료 그대로다.
import type { ClubHistoryData } from './historyTypes';

export const KBO_HISTORY: ClubHistoryData[] = [
  {
    "clubId": 1,
    "firstSeason": 1982,
    "seasons": [
      {
        "year": 1982,
        "rank": 3,
        "wins": 46,
        "losses": 34,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 1983,
        "rank": 2,
        "wins": 55,
        "losses": 43,
        "ties": 2,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 1984,
        "rank": 4,
        "wins": 51,
        "losses": 48,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 1985,
        "rank": 5,
        "wins": 44,
        "losses": 65,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 1986,
        "rank": 3,
        "wins": 59,
        "losses": 41,
        "ties": 8,
        "postseason": ""
      },
      {
        "year": 1987,
        "rank": 5,
        "wins": 50,
        "losses": 51,
        "ties": 7,
        "postseason": ""
      },
      {
        "year": 1988,
        "rank": 7,
        "wins": 40,
        "losses": 64,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 1989,
        "rank": 6,
        "wins": 49,
        "losses": 67,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 1990,
        "rank": 1,
        "wins": 71,
        "losses": 49,
        "ties": 0,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1991,
        "rank": 6,
        "wins": 53,
        "losses": 72,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 1992,
        "rank": 7,
        "wins": 53,
        "losses": 70,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 1993,
        "rank": 4,
        "wins": 66,
        "losses": 57,
        "ties": 3,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 1994,
        "rank": 1,
        "wins": 81,
        "losses": 45,
        "ties": 0,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1995,
        "rank": 3,
        "wins": 74,
        "losses": 48,
        "ties": 4,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 1996,
        "rank": 7,
        "wins": 50,
        "losses": 71,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 1997,
        "rank": 2,
        "wins": 73,
        "losses": 51,
        "ties": 2,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 1998,
        "rank": 2,
        "wins": 63,
        "losses": 62,
        "ties": 1,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 1999,
        "rank": 6,
        "wins": 61,
        "losses": 70,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2000,
        "rank": 4,
        "wins": 67,
        "losses": 63,
        "ties": 3,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2001,
        "rank": 6,
        "wins": 58,
        "losses": 67,
        "ties": 8,
        "postseason": ""
      },
      {
        "year": 2002,
        "rank": 2,
        "wins": 66,
        "losses": 61,
        "ties": 6,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2003,
        "rank": 6,
        "wins": 60,
        "losses": 71,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2004,
        "rank": 6,
        "wins": 59,
        "losses": 70,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 2005,
        "rank": 6,
        "wins": 54,
        "losses": 71,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2006,
        "rank": 8,
        "wins": 47,
        "losses": 75,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 2007,
        "rank": 5,
        "wins": 58,
        "losses": 62,
        "ties": 6,
        "postseason": ""
      },
      {
        "year": 2008,
        "rank": 8,
        "wins": 46,
        "losses": 80,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2009,
        "rank": 7,
        "wins": 54,
        "losses": 75,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 2010,
        "rank": 6,
        "wins": 57,
        "losses": 71,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 2011,
        "rank": 6,
        "wins": 59,
        "losses": 72,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2012,
        "rank": 7,
        "wins": 57,
        "losses": 72,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 2013,
        "rank": 3,
        "wins": 74,
        "losses": 54,
        "ties": 0,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2014,
        "rank": 4,
        "wins": 62,
        "losses": 64,
        "ties": 2,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2015,
        "rank": 9,
        "wins": 64,
        "losses": 78,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2016,
        "rank": 4,
        "wins": 71,
        "losses": 71,
        "ties": 2,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2017,
        "rank": 6,
        "wins": 69,
        "losses": 72,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2018,
        "rank": 8,
        "wins": 68,
        "losses": 75,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2019,
        "rank": 4,
        "wins": 79,
        "losses": 64,
        "ties": 1,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2020,
        "rank": 4,
        "wins": 79,
        "losses": 61,
        "ties": 4,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2021,
        "rank": 4,
        "wins": 72,
        "losses": 58,
        "ties": 14,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2022,
        "rank": 3,
        "wins": 87,
        "losses": 55,
        "ties": 2,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2023,
        "rank": 1,
        "wins": 86,
        "losses": 56,
        "ties": 2,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2024,
        "rank": 3,
        "wins": 76,
        "losses": 66,
        "ties": 2,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2025,
        "rank": 1,
        "wins": 85,
        "losses": 56,
        "ties": 3,
        "postseason": "한국시리즈 우승"
      }
    ],
    "regularSeasonFirst": [
      1990,
      1994,
      2023,
      2025
    ],
    "legends": [
      {
        "name": "윤채직",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 1985,
        "lastYear": 2000,
        "retiredNumber": 41,
        "isPitcher": true,
        "career": {
          "G": 613,
          "GS": 129,
          "W": 126,
          "L": 89,
          "SV": 227,
          "HLD": 1,
          "IP": 1831.1,
          "H": 1672,
          "ER": 606,
          "BB": 498,
          "SO": 1146,
          "ERA": 2.98
        }
      },
      {
        "name": "윤세흠",
        "position": "CF",
        "bats": "L",
        "throws": "L",
        "firstYear": 1997,
        "lastYear": 2016,
        "retiredNumber": 9,
        "isPitcher": false,
        "career": {
          "G": 1741,
          "PA": 7247,
          "AB": 6571,
          "H": 2043,
          "2B": 371,
          "3B": 38,
          "HR": 161,
          "RBI": 972,
          "R": 992,
          "BB": 526,
          "SO": 838,
          "SB": 147,
          "AVG": 0.311
        }
      },
      {
        "name": "임가앙",
        "position": "LF",
        "bats": "L",
        "throws": "R",
        "firstYear": 2002,
        "lastYear": 2020,
        "retiredNumber": 33,
        "isPitcher": false,
        "career": {
          "G": 2236,
          "PA": null,
          "AB": 8139,
          "H": 2504,
          "2B": 441,
          "3B": 44,
          "HR": 213,
          "RBI": 1192,
          "R": 1259,
          "BB": 793,
          "SO": 1392,
          "SB": 313,
          "AVG": 0.308
        }
      },
      {
        "name": "김병령",
        "position": "P",
        "bats": "L",
        "throws": "L",
        "firstYear": 1993,
        "lastYear": 2003,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 308,
          "GS": 84,
          "W": 71,
          "L": 40,
          "SV": 98,
          "HLD": 1,
          "IP": 909.2,
          "H": 651,
          "ER": 259,
          "BB": 302,
          "SO": 781,
          "ERA": 2.56
        }
      },
      {
        "name": "권청중",
        "position": "SS",
        "bats": "R",
        "throws": "R",
        "firstYear": 1994,
        "lastYear": 2004,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1108,
          "PA": null,
          "AB": 4050,
          "H": 1134,
          "2B": 193,
          "3B": 17,
          "HR": 64,
          "RBI": 379,
          "R": 719,
          "BB": null,
          "SO": 537,
          "SB": 296,
          "AVG": 0.28
        }
      },
      {
        "name": "성현중",
        "position": "C",
        "bats": "R",
        "throws": "R",
        "firstYear": 1990,
        "lastYear": 1999,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 2039,
          "PA": 6940,
          "AB": 5915,
          "H": 1556,
          "2B": 286,
          "3B": 28,
          "HR": 202,
          "RBI": 871,
          "R": 741,
          "BB": 661,
          "SO": 821,
          "SB": 56,
          "AVG": 0.263
        }
      },
      {
        "name": "문솔영",
        "position": "P",
        "bats": "L",
        "throws": "L",
        "firstYear": 2007,
        "lastYear": 2016,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 302,
          "GS": 109,
          "W": 55,
          "L": 46,
          "SV": 109,
          "HLD": 0,
          "IP": 863,
          "H": 794,
          "ER": 341,
          "BB": 355,
          "SO": 654,
          "ERA": 3.35
        }
      },
      {
        "name": "이래흥",
        "position": "SS",
        "bats": "L",
        "throws": "R",
        "firstYear": 2009,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1985,
          "PA": null,
          "AB": 6743,
          "H": 1779,
          "2B": 347,
          "3B": 63,
          "HR": 180,
          "RBI": 928,
          "R": 1069,
          "BB": 822,
          "SO": 1726,
          "SB": 282,
          "AVG": 0.264
        }
      },
      {
        "name": "엄이추",
        "position": "1B",
        "bats": "L",
        "throws": "L",
        "firstYear": 1994,
        "lastYear": 2006,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 796,
          "PA": null,
          "AB": 2552,
          "H": 746,
          "2B": 135,
          "3B": 22,
          "HR": 21,
          "RBI": 341,
          "R": 300,
          "BB": 233,
          "SO": 340,
          "SB": 31,
          "AVG": 0.292
        }
      },
      {
        "name": "정정옥",
        "position": "P",
        "bats": "L",
        "throws": "R",
        "firstYear": 1985,
        "lastYear": 1996,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 388,
          "GS": null,
          "W": 106,
          "L": 121,
          "SV": 47,
          "HLD": 0,
          "IP": 1894.2,
          "H": 1783,
          "ER": 763,
          "BB": 663,
          "SO": 939,
          "ERA": 3.62
        }
      }
    ],
    "records": [
      {
        "label": "최다 홈런",
        "holder": "브렛 웨일",
        "year": 2020,
        "value": 38
      },
      {
        "label": "최다 타점",
        "holder": "이선 몰리",
        "year": 2024,
        "value": 132
      },
      {
        "label": "최다 안타",
        "holder": "이름 미상",
        "year": null,
        "value": null
      },
      {
        "label": "최고 타율(규정 타석)",
        "holder": "백운학",
        "year": 1982,
        "value": 0.412
      },
      {
        "label": "최다승",
        "holder": "김병령",
        "year": 1995,
        "value": 20
      },
      {
        "label": "최다 세이브",
        "holder": "진훈항",
        "year": 2022,
        "value": 42
      },
      {
        "label": "최다 탈삼진",
        "holder": "이름 미상",
        "year": null,
        "value": null
      },
      {
        "label": "최저 평균자책(규정 이닝)",
        "holder": "이름 미상",
        "year": null,
        "value": null
      }
    ]
  },
  {
    "clubId": 2,
    "firstSeason": 1982,
    "seasons": [
      {
        "year": 1982,
        "rank": 1,
        "wins": 56,
        "losses": 24,
        "ties": 0,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1983,
        "rank": 5,
        "wins": 44,
        "losses": 55,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 1984,
        "rank": 3,
        "wins": 58,
        "losses": 41,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 1985,
        "rank": 4,
        "wins": 51,
        "losses": 57,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 1986,
        "rank": 4,
        "wins": 56,
        "losses": 48,
        "ties": 4,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 1987,
        "rank": 4,
        "wins": 55,
        "losses": 52,
        "ties": 1,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 1988,
        "rank": 5,
        "wins": 54,
        "losses": 52,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 1989,
        "rank": 5,
        "wins": 54,
        "losses": 63,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 1990,
        "rank": 7,
        "wins": 35,
        "losses": 80,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 1991,
        "rank": 8,
        "wins": 51,
        "losses": 73,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 1992,
        "rank": 5,
        "wins": 56,
        "losses": 66,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 1993,
        "rank": 3,
        "wins": 66,
        "losses": 55,
        "ties": 5,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 1994,
        "rank": 7,
        "wins": 53,
        "losses": 72,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 1995,
        "rank": 1,
        "wins": 74,
        "losses": 47,
        "ties": 5,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1996,
        "rank": 8,
        "wins": 47,
        "losses": 73,
        "ties": 6,
        "postseason": ""
      },
      {
        "year": 1997,
        "rank": 5,
        "wins": 57,
        "losses": 64,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 1998,
        "rank": 4,
        "wins": 61,
        "losses": 62,
        "ties": 3,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 1999,
        "rank": 3,
        "wins": 76,
        "losses": 51,
        "ties": 5,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2000,
        "rank": 2,
        "wins": 76,
        "losses": 57,
        "ties": 0,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2001,
        "rank": 1,
        "wins": 65,
        "losses": 63,
        "ties": 5,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2002,
        "rank": 5,
        "wins": 66,
        "losses": 65,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2003,
        "rank": 7,
        "wins": 57,
        "losses": 74,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2004,
        "rank": 3,
        "wins": 70,
        "losses": 62,
        "ties": 1,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2005,
        "rank": 2,
        "wins": 72,
        "losses": 51,
        "ties": 3,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2006,
        "rank": 5,
        "wins": 63,
        "losses": 60,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2007,
        "rank": 2,
        "wins": 70,
        "losses": 54,
        "ties": 2,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2008,
        "rank": 2,
        "wins": 70,
        "losses": 56,
        "ties": 0,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2009,
        "rank": 3,
        "wins": 71,
        "losses": 60,
        "ties": 2,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2010,
        "rank": 3,
        "wins": 73,
        "losses": 57,
        "ties": 3,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2011,
        "rank": 5,
        "wins": 61,
        "losses": 70,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2012,
        "rank": 3,
        "wins": 68,
        "losses": 62,
        "ties": 3,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2013,
        "rank": 2,
        "wins": 71,
        "losses": 54,
        "ties": 3,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2014,
        "rank": 6,
        "wins": 59,
        "losses": 68,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2015,
        "rank": 1,
        "wins": 79,
        "losses": 65,
        "ties": 0,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2016,
        "rank": 1,
        "wins": 93,
        "losses": 50,
        "ties": 1,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2017,
        "rank": 2,
        "wins": 84,
        "losses": 57,
        "ties": 3,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2018,
        "rank": 2,
        "wins": 93,
        "losses": 51,
        "ties": 0,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2019,
        "rank": 1,
        "wins": 88,
        "losses": 55,
        "ties": 1,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2020,
        "rank": 2,
        "wins": 79,
        "losses": 61,
        "ties": 4,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2021,
        "rank": 2,
        "wins": 71,
        "losses": 65,
        "ties": 8,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2022,
        "rank": 9,
        "wins": 60,
        "losses": 82,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2023,
        "rank": 5,
        "wins": 74,
        "losses": 68,
        "ties": 2,
        "postseason": "와일드카드 탈락"
      },
      {
        "year": 2024,
        "rank": 4,
        "wins": 74,
        "losses": 68,
        "ties": 2,
        "postseason": "와일드카드 탈락"
      },
      {
        "year": 2025,
        "rank": 9,
        "wins": 61,
        "losses": 77,
        "ties": 6,
        "postseason": ""
      }
    ],
    "regularSeasonFirst": [
      1982,
      1995,
      2016,
      2018,
      2019
    ],
    "legends": [
      {
        "name": "현혁흠",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 1982,
        "lastYear": 1996,
        "retiredNumber": 21,
        "isPitcher": true,
        "career": {
          "G": 231,
          "GS": 133,
          "W": 76,
          "L": 53,
          "SV": 20,
          "HLD": 0,
          "IP": 1050.1,
          "H": 908,
          "ER": 344,
          "BB": 391,
          "SO": 648,
          "ERA": 2.95
        }
      },
      {
        "name": "석찬익",
        "position": "C",
        "bats": "R",
        "throws": "R",
        "firstYear": 1985,
        "lastYear": 1986,
        "retiredNumber": 54,
        "isPitcher": false,
        "career": {
          "G": 22,
          "PA": null,
          "AB": 32,
          "H": 5,
          "2B": 0,
          "3B": 0,
          "HR": 0,
          "RBI": 2,
          "R": 1,
          "BB": null,
          "SO": 5,
          "SB": 0,
          "AVG": 0.156
        }
      },
      {
        "name": "양병직",
        "position": "3B",
        "bats": "R",
        "throws": "R",
        "firstYear": 1998,
        "lastYear": 2013,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1625,
          "PA": 6592,
          "AB": 5540,
          "H": 1710,
          "2B": 293,
          "3B": 12,
          "HR": 273,
          "RBI": 1097,
          "R": 851,
          "BB": 814,
          "SO": 794,
          "SB": 48,
          "AVG": 0.309
        }
      },
      {
        "name": "황하욱",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 1983,
        "lastYear": 1995,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 346,
          "GS": 230,
          "W": 109,
          "L": 110,
          "SV": 17,
          "HLD": 0,
          "IP": 1805,
          "H": 1680,
          "ER": 653,
          "BB": 626,
          "SO": 625,
          "ERA": 3.26
        }
      },
      {
        "name": "한래랑",
        "position": "LF",
        "bats": "L",
        "throws": "R",
        "firstYear": 2006,
        "lastYear": 2015,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 2221,
          "PA": null,
          "AB": null,
          "H": 2532,
          "2B": null,
          "3B": null,
          "HR": 261,
          "RBI": 1522,
          "R": 1256,
          "BB": null,
          "SO": null,
          "SB": null,
          "AVG": 0.312
        }
      },
      {
        "name": "조태영",
        "position": "C",
        "bats": "R",
        "throws": "R",
        "firstYear": 2006,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1963,
          "PA": null,
          "AB": 6358,
          "H": 1968,
          "2B": 353,
          "3B": 12,
          "HR": 282,
          "RBI": 1195,
          "R": 932,
          "BB": 718,
          "SO": 820,
          "SB": 60,
          "AVG": 0.31
        }
      },
      {
        "name": "칼 데이비슨",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 2011,
        "lastYear": 2017,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 214,
          "GS": 205,
          "W": 102,
          "L": 51,
          "SV": 0,
          "HLD": 1,
          "IP": 1291.1,
          "H": 1239,
          "ER": 515,
          "BB": 420,
          "SO": 1082,
          "ERA": 3.59
        }
      },
      {
        "name": "노온옥",
        "position": "LF",
        "bats": "L",
        "throws": "R",
        "firstYear": 2008,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1486,
          "PA": null,
          "AB": 5072,
          "H": 1425,
          "2B": 269,
          "3B": 17,
          "HR": 276,
          "RBI": 982,
          "R": 836,
          "BB": 737,
          "SO": 1335,
          "SB": 44,
          "AVG": 0.281
        }
      },
      {
        "name": "전호랑",
        "position": "P",
        "bats": "L",
        "throws": "L",
        "firstYear": 2009,
        "lastYear": 2021,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 281,
          "GS": null,
          "W": 101,
          "L": 69,
          "SV": 1,
          "HLD": 4,
          "IP": 1410,
          "H": 1661,
          "ER": null,
          "BB": 401,
          "SO": 777,
          "ERA": 4.58
        }
      },
      {
        "name": "양수란",
        "position": "C",
        "bats": "R",
        "throws": "R",
        "firstYear": 1999,
        "lastYear": 2016,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1957,
          "PA": 7637,
          "AB": 6789,
          "H": 2046,
          "2B": 323,
          "3B": 12,
          "HR": 208,
          "RBI": 1120,
          "R": 872,
          "BB": 645,
          "SO": 1018,
          "SB": 85,
          "AVG": 0.301
        }
      }
    ],
    "records": [
      {
        "label": "최다 홈런",
        "holder": "노온옥",
        "year": 2018,
        "value": 44
      },
      {
        "label": "최다 타점",
        "holder": "노온옥",
        "year": 2018,
        "value": 133
      },
      {
        "label": "최다 안타",
        "holder": "피트 갤러거 2",
        "year": 2019,
        "value": 197
      },
      {
        "label": "최고 타율(규정 타석)",
        "holder": "이름 미상",
        "year": null,
        "value": null
      },
      {
        "label": "최다승",
        "holder": "현혁흠",
        "year": 1982,
        "value": 24
      },
      {
        "label": "최다 세이브",
        "holder": "정완림",
        "year": 2000,
        "value": 42
      },
      {
        "label": "최다 탈삼진",
        "holder": "이선 몰리 2",
        "year": 2021,
        "value": 225
      },
      {
        "label": "최저 평균자책(규정 이닝)",
        "holder": "이름 미상",
        "year": null,
        "value": null
      }
    ]
  },
  {
    "clubId": 3,
    "firstSeason": 2008,
    "seasons": [
      {
        "year": 2008,
        "rank": 7,
        "wins": 50,
        "losses": 76,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2009,
        "rank": 6,
        "wins": 60,
        "losses": 72,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2010,
        "rank": 7,
        "wins": 52,
        "losses": 78,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2011,
        "rank": 8,
        "wins": 51,
        "losses": 80,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2012,
        "rank": 6,
        "wins": 61,
        "losses": 69,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2013,
        "rank": 4,
        "wins": 72,
        "losses": 54,
        "ties": 2,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2014,
        "rank": 2,
        "wins": 78,
        "losses": 48,
        "ties": 2,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2015,
        "rank": 4,
        "wins": 78,
        "losses": 65,
        "ties": 1,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2016,
        "rank": 3,
        "wins": 77,
        "losses": 66,
        "ties": 1,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2017,
        "rank": 7,
        "wins": 69,
        "losses": 73,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2018,
        "rank": 4,
        "wins": 75,
        "losses": 69,
        "ties": 0,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2019,
        "rank": 2,
        "wins": 86,
        "losses": 57,
        "ties": 1,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2020,
        "rank": 5,
        "wins": 80,
        "losses": 63,
        "ties": 1,
        "postseason": "와일드카드 탈락"
      },
      {
        "year": 2021,
        "rank": 5,
        "wins": 70,
        "losses": 67,
        "ties": 7,
        "postseason": "와일드카드 탈락"
      },
      {
        "year": 2022,
        "rank": 2,
        "wins": 80,
        "losses": 62,
        "ties": 2,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2023,
        "rank": 10,
        "wins": 58,
        "losses": 83,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2024,
        "rank": 10,
        "wins": 58,
        "losses": 86,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2025,
        "rank": 10,
        "wins": 47,
        "losses": 93,
        "ties": 4,
        "postseason": ""
      }
    ],
    "regularSeasonFirst": [],
    "legends": [
      {
        "name": "손창전",
        "position": "1B",
        "bats": "R",
        "throws": "R",
        "firstYear": 2011,
        "lastYear": 2021,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1767,
          "PA": 6769,
          "AB": 5704,
          "H": 1554,
          "2B": 253,
          "3B": 5,
          "HR": 418,
          "RBI": 1244,
          "R": 1022,
          "BB": 842,
          "SO": 1723,
          "SB": 70,
          "AVG": 0.272
        }
      },
      {
        "name": "백운교",
        "position": "CF",
        "bats": "L",
        "throws": "R",
        "firstYear": 2017,
        "lastYear": 2023,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 884,
          "PA": null,
          "AB": 3476,
          "H": 1181,
          "2B": 244,
          "3B": 43,
          "HR": 65,
          "RBI": 515,
          "R": 581,
          "BB": 383,
          "SO": 304,
          "SB": 69,
          "AVG": 0.34
        }
      },
      {
        "name": "한석길",
        "position": "SS",
        "bats": "R",
        "throws": "R",
        "firstYear": 2014,
        "lastYear": 2020,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 891,
          "PA": 3664,
          "AB": 3195,
          "H": 940,
          "2B": 191,
          "3B": 23,
          "HR": 133,
          "RBI": 575,
          "R": 606,
          "BB": 381,
          "SO": 502,
          "SB": 134,
          "AVG": 0.294
        }
      },
      {
        "name": "송단랑",
        "position": "SS",
        "bats": "R",
        "throws": "R",
        "firstYear": 2008,
        "lastYear": 2014,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 902,
          "PA": 3560,
          "AB": 3070,
          "H": 916,
          "2B": 193,
          "3B": 10,
          "HR": 139,
          "RBI": 545,
          "R": 470,
          "BB": 387,
          "SO": 601,
          "SB": 51,
          "AVG": 0.298
        }
      },
      {
        "name": "우완규",
        "position": "2B",
        "bats": "L",
        "throws": "R",
        "firstYear": 2012,
        "lastYear": 2021,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1360,
          "PA": null,
          "AB": 4822,
          "H": 1431,
          "2B": 274,
          "3B": 57,
          "HR": 41,
          "RBI": 519,
          "R": 854,
          "BB": 604,
          "SO": 569,
          "SB": 233,
          "AVG": 0.297
        }
      },
      {
        "name": "송청란",
        "position": "2B",
        "bats": "L",
        "throws": "R",
        "firstYear": 2017,
        "lastYear": 2024,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 689,
          "PA": null,
          "AB": 2924,
          "H": 877,
          "2B": 125,
          "3B": 35,
          "HR": 56,
          "RBI": 311,
          "R": 501,
          "BB": 277,
          "SO": 561,
          "SB": 181,
          "AVG": 0.3
        }
      },
      {
        "name": "우언흥",
        "position": "CF",
        "bats": "R",
        "throws": "R",
        "firstYear": 2008,
        "lastYear": 2020,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1651,
          "PA": null,
          "AB": 5361,
          "H": 1621,
          "2B": 299,
          "3B": 12,
          "HR": 136,
          "RBI": 773,
          "R": 851,
          "BB": 591,
          "SO": 726,
          "SB": 175,
          "AVG": 0.302
        }
      },
      {
        "name": "레이 파울러",
        "position": "P",
        "bats": "R",
        "throws": "L",
        "firstYear": 2012,
        "lastYear": 2017,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 156,
          "GS": 156,
          "W": 73,
          "L": 42,
          "SV": 0,
          "HLD": 0,
          "IP": 925.2,
          "H": 922,
          "ER": 366,
          "BB": 299,
          "SO": 860,
          "ERA": 3.56
        }
      },
      {
        "name": "오헌철",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 2010,
        "lastYear": 2015,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 601,
          "GS": null,
          "W": 45,
          "L": 49,
          "SV": 271,
          "HLD": 7,
          "IP": 804.2,
          "H": 824,
          "ER": 325,
          "BB": 232,
          "SO": 662,
          "ERA": 3.64
        }
      },
      {
        "name": "장열익",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 2018,
        "lastYear": 2023,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 156,
          "GS": null,
          "W": 43,
          "L": 35,
          "SV": 2,
          "HLD": 14,
          "IP": 620,
          "H": 503,
          "ER": 221,
          "BB": 215,
          "SO": 665,
          "ERA": 3.21
        }
      }
    ],
    "records": [
      {
        "label": "최다 홈런",
        "holder": "손창전",
        "year": 2015,
        "value": 53
      },
      {
        "label": "최다 타점",
        "holder": "손창전",
        "year": 2015,
        "value": 146
      },
      {
        "label": "최다 안타",
        "holder": "우완규",
        "year": 2014,
        "value": 201
      },
      {
        "label": "최고 타율(규정 타석)",
        "holder": "우완규",
        "year": 2014,
        "value": 0.37
      },
      {
        "label": "최다승",
        "holder": "레이 파울러",
        "year": 2014,
        "value": 20
      },
      {
        "label": "최다 세이브",
        "holder": "오헌철",
        "year": 2013,
        "value": 46
      },
      {
        "label": "최다 탈삼진",
        "holder": "장열익",
        "year": 2022,
        "value": 224
      },
      {
        "label": "최저 평균자책(규정 이닝)",
        "holder": "장열익",
        "year": 2022,
        "value": 2.11
      }
    ]
  },
  {
    "clubId": 4,
    "firstSeason": 2000,
    "seasons": [
      {
        "year": 2000,
        "rank": 8,
        "wins": 44,
        "losses": 86,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2001,
        "rank": 7,
        "wins": 60,
        "losses": 71,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2002,
        "rank": 6,
        "wins": 61,
        "losses": 69,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2003,
        "rank": 2,
        "wins": 66,
        "losses": 64,
        "ties": 3,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2004,
        "rank": 5,
        "wins": 61,
        "losses": 64,
        "ties": 8,
        "postseason": ""
      },
      {
        "year": 2005,
        "rank": 3,
        "wins": 70,
        "losses": 50,
        "ties": 6,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2006,
        "rank": 6,
        "wins": 60,
        "losses": 65,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2007,
        "rank": 1,
        "wins": 73,
        "losses": 48,
        "ties": 5,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2008,
        "rank": 1,
        "wins": 83,
        "losses": 43,
        "ties": 0,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2009,
        "rank": 2,
        "wins": 80,
        "losses": 47,
        "ties": 6,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2010,
        "rank": 1,
        "wins": 84,
        "losses": 47,
        "ties": 2,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2011,
        "rank": 2,
        "wins": 71,
        "losses": 59,
        "ties": 3,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2012,
        "rank": 2,
        "wins": 71,
        "losses": 59,
        "ties": 3,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2013,
        "rank": 6,
        "wins": 62,
        "losses": 63,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2014,
        "rank": 5,
        "wins": 61,
        "losses": 65,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2015,
        "rank": 5,
        "wins": 69,
        "losses": 73,
        "ties": 2,
        "postseason": "와일드카드 탈락"
      },
      {
        "year": 2016,
        "rank": 6,
        "wins": 69,
        "losses": 75,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2017,
        "rank": 5,
        "wins": 75,
        "losses": 68,
        "ties": 1,
        "postseason": "와일드카드 탈락"
      },
      {
        "year": 2018,
        "rank": 1,
        "wins": 78,
        "losses": 65,
        "ties": 1,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2019,
        "rank": 3,
        "wins": 88,
        "losses": 55,
        "ties": 1,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2020,
        "rank": 9,
        "wins": 51,
        "losses": 92,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2021,
        "rank": 6,
        "wins": 66,
        "losses": 64,
        "ties": 14,
        "postseason": ""
      },
      {
        "year": 2022,
        "rank": 1,
        "wins": 88,
        "losses": 52,
        "ties": 4,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2023,
        "rank": 3,
        "wins": 76,
        "losses": 65,
        "ties": 3,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2024,
        "rank": 6,
        "wins": 72,
        "losses": 70,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2025,
        "rank": 3,
        "wins": 75,
        "losses": 65,
        "ties": 4,
        "postseason": "준플레이오프 탈락"
      }
    ],
    "regularSeasonFirst": [
      2007,
      2008,
      2010,
      2022
    ],
    "legends": [
      {
        "name": "허률익",
        "position": "C",
        "bats": "R",
        "throws": "R",
        "firstYear": 2003,
        "lastYear": 2013,
        "retiredNumber": 26,
        "isPitcher": false,
        "career": {
          "G": 2043,
          "PA": 7326,
          "AB": 5946,
          "H": 1480,
          "2B": 271,
          "3B": 15,
          "HR": 314,
          "RBI": 995,
          "R": 913,
          "BB": 974,
          "SO": 1605,
          "SB": 75,
          "AVG": 0.249
        }
      },
      {
        "name": "홍택항",
        "position": "3B",
        "bats": "R",
        "throws": "R",
        "firstYear": 2005,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 2388,
          "PA": null,
          "AB": 8232,
          "H": 2352,
          "2B": 433,
          "3B": 11,
          "HR": 518,
          "RBI": 1624,
          "R": 1515,
          "BB": 1088,
          "SO": 1866,
          "SB": 179,
          "AVG": 0.286
        }
      },
      {
        "name": "신열중",
        "position": "P",
        "bats": "L",
        "throws": "L",
        "firstYear": 2007,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 415,
          "GS": null,
          "W": 180,
          "L": 108,
          "SV": 0,
          "HLD": 2,
          "IP": 2321.2,
          "H": 2207,
          "ER": 885,
          "BB": 884,
          "SO": 2020,
          "ERA": 3.43
        }
      },
      {
        "name": "주인잠",
        "position": "CF",
        "bats": "R",
        "throws": "R",
        "firstYear": 2001,
        "lastYear": 2023,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1960,
          "PA": null,
          "AB": 5440,
          "H": 1470,
          "2B": 266,
          "3B": 24,
          "HR": 139,
          "RBI": 681,
          "R": 810,
          "BB": 484,
          "SO": 1135,
          "SB": 209,
          "AVG": 0.273
        }
      },
      {
        "name": "윤동엽",
        "position": "RF",
        "bats": "R",
        "throws": "R",
        "firstYear": 2005,
        "lastYear": 2012,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1797,
          "PA": 7136,
          "AB": 6097,
          "H": 1732,
          "2B": 316,
          "3B": 26,
          "HR": 300,
          "RBI": 1081,
          "R": 1012,
          "BB": 875,
          "SO": 1147,
          "SB": 267,
          "AVG": 0.284
        }
      },
      {
        "name": "문보룡",
        "position": "2B",
        "bats": "R",
        "throws": "R",
        "firstYear": 2005,
        "lastYear": 2013,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1747,
          "PA": null,
          "AB": 6219,
          "H": 1877,
          "2B": 319,
          "3B": 34,
          "HR": 121,
          "RBI": 722,
          "R": 1072,
          "BB": 665,
          "SO": 731,
          "SB": 371,
          "AVG": 0.302
        }
      },
      {
        "name": "최병영",
        "position": "1B",
        "bats": "L",
        "throws": "L",
        "firstYear": 2004,
        "lastYear": 2019,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1308,
          "PA": null,
          "AB": 4150,
          "H": 1134,
          "2B": 209,
          "3B": 17,
          "HR": 178,
          "RBI": 679,
          "R": 611,
          "BB": 450,
          "SO": 942,
          "SB": 56,
          "AVG": 0.273
        }
      },
      {
        "name": "최온록",
        "position": "1B",
        "bats": "R",
        "throws": "R",
        "firstYear": 2000,
        "lastYear": 2012,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 2053,
          "PA": null,
          "AB": 6663,
          "H": 1880,
          "2B": 346,
          "3B": 17,
          "HR": 337,
          "RBI": 1265,
          "R": 943,
          "BB": 795,
          "SO": 1307,
          "SB": 59,
          "AVG": 0.282
        }
      },
      {
        "name": "민선조",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 2001,
        "lastYear": 2011,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 662,
          "GS": 0,
          "W": 46,
          "L": 29,
          "SV": 106,
          "HLD": 121,
          "IP": 726.1,
          "H": 579,
          "ER": 178,
          "BB": 236,
          "SO": 559,
          "ERA": 2.21
        }
      },
      {
        "name": "나석철",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 2002,
        "lastYear": 2019,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 451,
          "GS": null,
          "W": 84,
          "L": 73,
          "SV": 22,
          "HLD": 29,
          "IP": 1336,
          "H": 1331,
          "ER": 625,
          "BB": 496,
          "SO": 968,
          "ERA": 4.21
        }
      }
    ],
    "records": [
      {
        "label": "최다 홈런",
        "holder": "홍택항",
        "year": 2017,
        "value": 46
      },
      {
        "label": "최다 타점",
        "holder": "구병섭",
        "year": 2018,
        "value": 115
      },
      {
        "label": "최다 안타",
        "holder": "숀 맥케이",
        "year": 2024,
        "value": 195
      },
      {
        "label": "최고 타율(규정 타석)",
        "holder": "숀 맥케이",
        "year": 2024,
        "value": 0.36
      },
      {
        "label": "최다승",
        "holder": "신열중",
        "year": 2010,
        "value": 17
      },
      {
        "label": "최다 세이브",
        "holder": "류채일",
        "year": 2023,
        "value": 42
      },
      {
        "label": "최다 탈삼진",
        "holder": "로건 하퍼",
        "year": 2025,
        "value": 245
      },
      {
        "label": "최저 평균자책(규정 이닝)",
        "holder": "신열중",
        "year": 2022,
        "value": 2.13
      }
    ]
  },
  {
    "clubId": 5,
    "firstSeason": 2015,
    "seasons": [
      {
        "year": 2015,
        "rank": 10,
        "wins": 52,
        "losses": 91,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2016,
        "rank": 10,
        "wins": 53,
        "losses": 89,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2017,
        "rank": 10,
        "wins": 50,
        "losses": 94,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2018,
        "rank": 9,
        "wins": 59,
        "losses": 82,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2019,
        "rank": 6,
        "wins": 71,
        "losses": 71,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2020,
        "rank": 3,
        "wins": 81,
        "losses": 62,
        "ties": 1,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2021,
        "rank": 1,
        "wins": 76,
        "losses": 59,
        "ties": 9,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2022,
        "rank": 4,
        "wins": 80,
        "losses": 62,
        "ties": 2,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2023,
        "rank": 2,
        "wins": 79,
        "losses": 62,
        "ties": 3,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2024,
        "rank": 5,
        "wins": 72,
        "losses": 70,
        "ties": 2,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2025,
        "rank": 6,
        "wins": 71,
        "losses": 68,
        "ties": 5,
        "postseason": ""
      }
    ],
    "regularSeasonFirst": [
      2021
    ],
    "legends": [
      {
        "name": "이건권",
        "position": "2B",
        "bats": "R",
        "throws": "R",
        "firstYear": 2015,
        "lastYear": 2024,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 2043,
          "PA": null,
          "AB": 5608,
          "H": 1396,
          "2B": 270,
          "3B": 13,
          "HR": 161,
          "RBI": 719,
          "R": 727,
          "BB": 783,
          "SO": 1360,
          "SB": 78,
          "AVG": 0.249
        }
      },
      {
        "name": "주성춘",
        "position": "3B",
        "bats": "R",
        "throws": "R",
        "firstYear": 2018,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 2200,
          "PA": 8891,
          "AB": 7937,
          "H": 2266,
          "2B": 423,
          "3B": 45,
          "HR": 227,
          "RBI": 1121,
          "R": 1172,
          "BB": 745,
          "SO": 1496,
          "SB": 235,
          "AVG": 0.285
        }
      },
      {
        "name": "손성형",
        "position": "1B",
        "bats": "L",
        "throws": "R",
        "firstYear": 2018,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 897,
          "PA": null,
          "AB": 3327,
          "H": 1009,
          "2B": 204,
          "3B": 7,
          "HR": 136,
          "RBI": 565,
          "R": 540,
          "BB": 439,
          "SO": 679,
          "SB": 40,
          "AVG": 0.303
        }
      },
      {
        "name": "칼 데이비슨 2",
        "position": "CF",
        "bats": "S",
        "throws": "R",
        "firstYear": 2017,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 750,
          "PA": 3272,
          "AB": null,
          "H": 900,
          "2B": 185,
          "3B": 9,
          "HR": 178,
          "RBI": 564,
          "R": 506,
          "BB": 344,
          "SO": 661,
          "SB": 30,
          "AVG": 0.313
        }
      },
      {
        "name": "류찬삼",
        "position": "C",
        "bats": "R",
        "throws": "R",
        "firstYear": 2015,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1482,
          "PA": null,
          "AB": 4181,
          "H": 1088,
          "2B": 158,
          "3B": 2,
          "HR": 133,
          "RBI": 647,
          "R": 451,
          "BB": 499,
          "SO": 865,
          "SB": 13,
          "AVG": 0.26
        }
      },
      {
        "name": "전열웅",
        "position": "RF",
        "bats": "R",
        "throws": "R",
        "firstYear": 2016,
        "lastYear": 2021,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1650,
          "PA": null,
          "AB": 5316,
          "H": 1606,
          "2B": 284,
          "3B": 6,
          "HR": 151,
          "RBI": 883,
          "R": 717,
          "BB": 594,
          "SO": null,
          "SB": 35,
          "AVG": 0.302
        }
      },
      {
        "name": "임서주",
        "position": "CF",
        "bats": "R",
        "throws": "R",
        "firstYear": 2015,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 952,
          "PA": null,
          "AB": null,
          "H": 702,
          "2B": 130,
          "3B": 9,
          "HR": 43,
          "RBI": 325,
          "R": 393,
          "BB": 306,
          "SO": 721,
          "SB": 93,
          "AVG": 0.26
        }
      },
      {
        "name": "유해곤",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 2015,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 278,
          "GS": null,
          "W": 72,
          "L": 66,
          "SV": 0,
          "HLD": 7,
          "IP": 1181.2,
          "H": 1308,
          "ER": 520,
          "BB": 192,
          "SO": 1011,
          "ERA": 3.96
        }
      },
      {
        "name": "권가덕",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 2015,
        "lastYear": 2023,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 609,
          "GS": null,
          "W": 52,
          "L": 48,
          "SV": 193,
          "HLD": 45,
          "IP": 628.1,
          "H": 585,
          "ER": 263,
          "BB": 176,
          "SO": 636,
          "ERA": 3.77
        }
      },
      {
        "name": "레이 파울러 2",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 2019,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 149,
          "GS": null,
          "W": 55,
          "L": 45,
          "SV": 0,
          "HLD": 0,
          "IP": 872.1,
          "H": 795,
          "ER": null,
          "BB": 294,
          "SO": 704,
          "ERA": 3.93
        }
      }
    ],
    "records": [
      {
        "label": "최다 홈런",
        "holder": "칼 데이비슨 2",
        "year": 2020,
        "value": 47
      },
      {
        "label": "최다 타점",
        "holder": "칼 데이비슨 2",
        "year": 2020,
        "value": 135
      },
      {
        "label": "최다 안타",
        "holder": "칼 데이비슨 2",
        "year": 2020,
        "value": 192
      },
      {
        "label": "최고 타율(규정 타석)",
        "holder": "칼 데이비슨 2",
        "year": 2020,
        "value": 0.349
      },
      {
        "label": "최다승",
        "holder": "트래비스 노턴 3",
        "year": 2020,
        "value": 15
      },
      {
        "label": "최다 세이브",
        "holder": "박단람",
        "year": 2025,
        "value": 35
      },
      {
        "label": "최다 탈삼진",
        "holder": "이름 미상",
        "year": null,
        "value": null
      },
      {
        "label": "최저 평균자책(규정 이닝)",
        "holder": "유해곤",
        "year": 2023,
        "value": 2.78
      }
    ]
  },
  {
    "clubId": 6,
    "firstSeason": 1986,
    "seasons": [
      {
        "year": 1986,
        "rank": 7,
        "wins": 31,
        "losses": 76,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 1987,
        "rank": 6,
        "wins": 47,
        "losses": 57,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 1988,
        "rank": 2,
        "wins": 62,
        "losses": 45,
        "ties": 1,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 1989,
        "rank": 2,
        "wins": 71,
        "losses": 46,
        "ties": 3,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 1990,
        "rank": 4,
        "wins": 68,
        "losses": 50,
        "ties": 2,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 1991,
        "rank": 2,
        "wins": 72,
        "losses": 49,
        "ties": 5,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 1992,
        "rank": 2,
        "wins": 81,
        "losses": 43,
        "ties": 2,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 1993,
        "rank": 5,
        "wins": 61,
        "losses": 61,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 1994,
        "rank": 3,
        "wins": 65,
        "losses": 59,
        "ties": 2,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 1995,
        "rank": 6,
        "wins": 55,
        "losses": 71,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 1996,
        "rank": 4,
        "wins": 70,
        "losses": 55,
        "ties": 1,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 1997,
        "rank": 7,
        "wins": 51,
        "losses": 73,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 1998,
        "rank": 7,
        "wins": 55,
        "losses": 66,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 1999,
        "rank": 1,
        "wins": 72,
        "losses": 58,
        "ties": 2,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2000,
        "rank": 7,
        "wins": 50,
        "losses": 78,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 2001,
        "rank": 4,
        "wins": 61,
        "losses": 68,
        "ties": 4,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2002,
        "rank": 7,
        "wins": 59,
        "losses": 69,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 2003,
        "rank": 5,
        "wins": 63,
        "losses": 65,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 2004,
        "rank": 7,
        "wins": 53,
        "losses": 74,
        "ties": 6,
        "postseason": ""
      },
      {
        "year": 2005,
        "rank": 4,
        "wins": 64,
        "losses": 61,
        "ties": 1,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2006,
        "rank": 2,
        "wins": 67,
        "losses": 57,
        "ties": 2,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2007,
        "rank": 3,
        "wins": 67,
        "losses": 57,
        "ties": 2,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2008,
        "rank": 5,
        "wins": 64,
        "losses": 62,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2009,
        "rank": 8,
        "wins": 46,
        "losses": 84,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2010,
        "rank": 8,
        "wins": 49,
        "losses": 82,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2011,
        "rank": 6,
        "wins": 59,
        "losses": 72,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2012,
        "rank": 8,
        "wins": 53,
        "losses": 77,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2013,
        "rank": 9,
        "wins": 42,
        "losses": 85,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2014,
        "rank": 9,
        "wins": 49,
        "losses": 77,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2015,
        "rank": 6,
        "wins": 68,
        "losses": 76,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2016,
        "rank": 7,
        "wins": 66,
        "losses": 75,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2017,
        "rank": 8,
        "wins": 61,
        "losses": 81,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2018,
        "rank": 3,
        "wins": 77,
        "losses": 67,
        "ties": 0,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2019,
        "rank": 9,
        "wins": 58,
        "losses": 86,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2020,
        "rank": 10,
        "wins": 46,
        "losses": 95,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2021,
        "rank": 10,
        "wins": 49,
        "losses": 83,
        "ties": 12,
        "postseason": ""
      },
      {
        "year": 2022,
        "rank": 10,
        "wins": 46,
        "losses": 96,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2023,
        "rank": 9,
        "wins": 58,
        "losses": 80,
        "ties": 6,
        "postseason": ""
      },
      {
        "year": 2024,
        "rank": 8,
        "wins": 66,
        "losses": 76,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2025,
        "rank": 2,
        "wins": 83,
        "losses": 57,
        "ties": 4,
        "postseason": "한국시리즈 준우승"
      }
    ],
    "regularSeasonFirst": [
      1989,
      1992
    ],
    "legends": [
      {
        "name": "도준령",
        "position": "P",
        "bats": "L",
        "throws": "L",
        "firstYear": 1989,
        "lastYear": 2009,
        "retiredNumber": 21,
        "isPitcher": true,
        "career": {
          "G": 672,
          "GS": null,
          "W": 210,
          "L": 153,
          "SV": 103,
          "HLD": 17,
          "IP": 3003,
          "H": 2718,
          "ER": null,
          "BB": 1155,
          "SO": 2048,
          "ERA": 3.51
        }
      },
      {
        "name": "권세춘",
        "position": "P",
        "bats": "L",
        "throws": "R",
        "firstYear": 1992,
        "lastYear": 2009,
        "retiredNumber": 23,
        "isPitcher": true,
        "career": {
          "G": 393,
          "GS": 370,
          "W": 161,
          "L": 128,
          "SV": 10,
          "HLD": 0,
          "IP": 2394.2,
          "H": 2194,
          "ER": 935,
          "BB": 655,
          "SO": 1661,
          "ERA": 3.51
        }
      },
      {
        "name": "손택형",
        "position": "SS",
        "bats": "R",
        "throws": "R",
        "firstYear": 1987,
        "lastYear": 2005,
        "retiredNumber": 35,
        "isPitcher": false,
        "career": {
          "G": 1950,
          "PA": 7374,
          "AB": 6292,
          "H": 1771,
          "2B": 331,
          "3B": 25,
          "HR": 340,
          "RBI": 1145,
          "R": 1043,
          "BB": 866,
          "SO": 1354,
          "SB": 122,
          "AVG": 0.281
        }
      },
      {
        "name": "석율반",
        "position": "1B",
        "bats": "R",
        "throws": "R",
        "firstYear": 2001,
        "lastYear": 2020,
        "retiredNumber": 52,
        "isPitcher": false,
        "career": {
          "G": 2014,
          "PA": 8225,
          "AB": 6900,
          "H": 2209,
          "2B": 399,
          "3B": 8,
          "HR": 311,
          "RBI": 1358,
          "R": 1024,
          "BB": 1141,
          "SO": 1384,
          "SB": 28,
          "AVG": 0.32
        }
      },
      {
        "name": "문률익",
        "position": "P",
        "bats": "R",
        "throws": "L",
        "firstYear": 2006,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 244,
          "GS": 235,
          "W": 117,
          "L": 67,
          "SV": 1,
          "HLD": 0,
          "IP": 1566.2,
          "H": 1407,
          "ER": 513,
          "BB": 441,
          "SO": 1495,
          "ERA": 2.95
        }
      },
      {
        "name": "석재룡",
        "position": "P",
        "bats": "L",
        "throws": "L",
        "firstYear": 1993,
        "lastYear": 2010,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 569,
          "GS": 43,
          "W": 67,
          "L": 71,
          "SV": 214,
          "HLD": 18,
          "IP": 1128.2,
          "H": 855,
          "ER": 357,
          "BB": 415,
          "SO": 1221,
          "ERA": 2.85
        }
      },
      {
        "name": "추건학",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 1988,
        "lastYear": 2004,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 482,
          "GS": null,
          "W": 120,
          "L": 118,
          "SV": 24,
          "HLD": 11,
          "IP": 2080,
          "H": 1933,
          "ER": 819,
          "BB": null,
          "SO": 1341,
          "ERA": 3.54
        }
      },
      {
        "name": "하홍령",
        "position": "P",
        "bats": "L",
        "throws": "L",
        "firstYear": 2016,
        "lastYear": 2024,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 1004,
          "GS": null,
          "W": 64,
          "L": 67,
          "SV": 197,
          "HLD": 145,
          "IP": 977.1,
          "H": 813,
          "ER": 345,
          "BB": 360,
          "SO": 937,
          "ERA": 3.18
        }
      },
      {
        "name": "우민겸",
        "position": "LF",
        "bats": "L",
        "throws": "R",
        "firstYear": 1996,
        "lastYear": 2010,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1312,
          "PA": null,
          "AB": null,
          "H": 1275,
          "2B": null,
          "3B": null,
          "HR": 135,
          "RBI": 533,
          "R": null,
          "BB": null,
          "SO": null,
          "SB": 112,
          "AVG": 0.293
        }
      },
      {
        "name": "레이 파울러 3",
        "position": "CF",
        "bats": "L",
        "throws": "L",
        "firstYear": 1999,
        "lastYear": 2006,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 836,
          "PA": null,
          "AB": 3130,
          "H": 979,
          "2B": null,
          "3B": null,
          "HR": 167,
          "RBI": 591,
          "R": 538,
          "BB": 353,
          "SO": 606,
          "SB": 108,
          "AVG": 0.313
        }
      }
    ],
    "records": [
      {
        "label": "최다 홈런",
        "holder": "손택형",
        "year": 1992,
        "value": 41
      },
      {
        "label": "최다 타점",
        "holder": "석율반",
        "year": 2016,
        "value": 136
      },
      {
        "label": "최다 안타",
        "holder": "석율반",
        "year": 2016,
        "value": 193
      },
      {
        "label": "최고 타율(규정 타석)",
        "holder": "석율반",
        "year": 2016,
        "value": 0.365
      },
      {
        "label": "최다승",
        "holder": "도준령",
        "year": 1992,
        "value": 19
      },
      {
        "label": "최다 세이브",
        "holder": "하홍령",
        "year": 2018,
        "value": 35
      },
      {
        "label": "최다 탈삼진",
        "holder": "트래비스 노턴",
        "year": 2025,
        "value": 252
      },
      {
        "label": "최저 평균자책(규정 이닝)",
        "holder": "문률익",
        "year": 2010,
        "value": 1.82
      }
    ]
  },
  {
    "clubId": 7,
    "firstSeason": 1982,
    "seasons": [
      {
        "year": 1982,
        "rank": 2,
        "wins": 54,
        "losses": 26,
        "ties": 0,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 1983,
        "rank": 4,
        "wins": 46,
        "losses": 50,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 1984,
        "rank": 2,
        "wins": 55,
        "losses": 45,
        "ties": 0,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 1985,
        "rank": 1,
        "wins": 77,
        "losses": 32,
        "ties": 1,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1986,
        "rank": 2,
        "wins": 70,
        "losses": 37,
        "ties": 1,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 1987,
        "rank": 2,
        "wins": 64,
        "losses": 44,
        "ties": 0,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 1988,
        "rank": 4,
        "wins": 56,
        "losses": 50,
        "ties": 2,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 1989,
        "rank": 4,
        "wins": 57,
        "losses": 58,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 1990,
        "rank": 2,
        "wins": 66,
        "losses": 52,
        "ties": 2,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 1991,
        "rank": 3,
        "wins": 70,
        "losses": 55,
        "ties": 1,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 1992,
        "rank": 4,
        "wins": 67,
        "losses": 57,
        "ties": 2,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 1993,
        "rank": 2,
        "wins": 73,
        "losses": 48,
        "ties": 5,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 1994,
        "rank": 5,
        "wins": 60,
        "losses": 64,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 1995,
        "rank": 5,
        "wins": 60,
        "losses": 60,
        "ties": 6,
        "postseason": ""
      },
      {
        "year": 1996,
        "rank": 6,
        "wins": 54,
        "losses": 67,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 1997,
        "rank": 3,
        "wins": 66,
        "losses": 53,
        "ties": 7,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 1998,
        "rank": 3,
        "wins": 66,
        "losses": 58,
        "ties": 2,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 1999,
        "rank": 4,
        "wins": 73,
        "losses": 57,
        "ties": 2,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2000,
        "rank": 3,
        "wins": 69,
        "losses": 59,
        "ties": 5,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2001,
        "rank": 2,
        "wins": 81,
        "losses": 52,
        "ties": 0,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2002,
        "rank": 1,
        "wins": 82,
        "losses": 47,
        "ties": 4,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2003,
        "rank": 4,
        "wins": 76,
        "losses": 53,
        "ties": 4,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2004,
        "rank": 2,
        "wins": 73,
        "losses": 52,
        "ties": 8,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2005,
        "rank": 1,
        "wins": 74,
        "losses": 48,
        "ties": 4,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2006,
        "rank": 1,
        "wins": 73,
        "losses": 50,
        "ties": 3,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2007,
        "rank": 4,
        "wins": 62,
        "losses": 60,
        "ties": 4,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2008,
        "rank": 4,
        "wins": 65,
        "losses": 61,
        "ties": 0,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2009,
        "rank": 5,
        "wins": 64,
        "losses": 69,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2010,
        "rank": 2,
        "wins": 79,
        "losses": 52,
        "ties": 2,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2011,
        "rank": 1,
        "wins": 79,
        "losses": 50,
        "ties": 4,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2012,
        "rank": 1,
        "wins": 80,
        "losses": 51,
        "ties": 2,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2013,
        "rank": 1,
        "wins": 75,
        "losses": 51,
        "ties": 2,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2014,
        "rank": 1,
        "wins": 78,
        "losses": 47,
        "ties": 3,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2015,
        "rank": 2,
        "wins": 88,
        "losses": 56,
        "ties": 0,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2016,
        "rank": 9,
        "wins": 65,
        "losses": 78,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2017,
        "rank": 9,
        "wins": 55,
        "losses": 84,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 2018,
        "rank": 6,
        "wins": 68,
        "losses": 72,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 2019,
        "rank": 8,
        "wins": 60,
        "losses": 83,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2020,
        "rank": 8,
        "wins": 64,
        "losses": 75,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 2021,
        "rank": 3,
        "wins": 76,
        "losses": 59,
        "ties": 9,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2022,
        "rank": 7,
        "wins": 66,
        "losses": 76,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2023,
        "rank": 8,
        "wins": 61,
        "losses": 82,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2024,
        "rank": 2,
        "wins": 78,
        "losses": 64,
        "ties": 2,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2025,
        "rank": 4,
        "wins": 74,
        "losses": 68,
        "ties": 2,
        "postseason": "플레이오프 탈락"
      }
    ],
    "regularSeasonFirst": [
      1985,
      1986,
      1987,
      2001,
      2002,
      2005,
      2006,
      2011,
      2012,
      2013,
      2014,
      2015
    ],
    "legends": [
      {
        "name": "장찬철",
        "position": "1B",
        "bats": "L",
        "throws": "L",
        "firstYear": 1995,
        "lastYear": 2017,
        "retiredNumber": 36,
        "isPitcher": false,
        "career": {
          "G": 1906,
          "PA": 8270,
          "AB": 7132,
          "H": 2156,
          "2B": 464,
          "3B": 28,
          "HR": 467,
          "RBI": 1498,
          "R": 1355,
          "BB": 953,
          "SO": 1344,
          "SB": 57,
          "AVG": 0.302
        }
      },
      {
        "name": "조율탄",
        "position": "1B",
        "bats": "L",
        "throws": "L",
        "firstYear": 1993,
        "lastYear": 2010,
        "retiredNumber": 10,
        "isPitcher": false,
        "career": {
          "G": 2135,
          "PA": 8807,
          "AB": 7332,
          "H": 2320,
          "2B": 458,
          "3B": 25,
          "HR": 351,
          "RBI": 1389,
          "R": 1299,
          "BB": 1278,
          "SO": 910,
          "SB": 193,
          "AVG": 0.316
        }
      },
      {
        "name": "엄보룡",
        "position": "C",
        "bats": "R",
        "throws": "R",
        "firstYear": 1982,
        "lastYear": 1997,
        "retiredNumber": 22,
        "isPitcher": false,
        "career": {
          "G": 1449,
          "PA": 5034,
          "AB": 4310,
          "H": 1276,
          "2B": 193,
          "3B": 7,
          "HR": 252,
          "RBI": 861,
          "R": 625,
          "BB": 554,
          "SO": 490,
          "SB": 52,
          "AVG": 0.296
        }
      },
      {
        "name": "장용형",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 2005,
        "lastYear": 2025,
        "retiredNumber": 21,
        "isPitcher": true,
        "career": {
          "G": 738,
          "GS": 1,
          "W": 44,
          "L": 33,
          "SV": 427,
          "HLD": 19,
          "IP": 803.2,
          "H": 604,
          "ER": 207,
          "BB": 200,
          "SO": 865,
          "ERA": 2.32
        }
      },
      {
        "name": "손보덕",
        "position": "LF",
        "bats": "L",
        "throws": "L",
        "firstYear": 1983,
        "lastYear": 1988,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 961,
          "PA": 3632,
          "AB": 3050,
          "H": 1008,
          "2B": 157,
          "3B": 36,
          "HR": 54,
          "RBI": 437,
          "R": 485,
          "BB": 506,
          "SO": 289,
          "SB": 109,
          "AVG": 0.33
        }
      },
      {
        "name": "장기탄",
        "position": "RF",
        "bats": "L",
        "throws": "L",
        "firstYear": 2001,
        "lastYear": 2019,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 2127,
          "PA": null,
          "AB": 7392,
          "H": 2174,
          "2B": 368,
          "3B": 32,
          "HR": 146,
          "RBI": 906,
          "R": 1211,
          "BB": 1028,
          "SO": 1130,
          "SB": 149,
          "AVG": 0.294
        }
      },
      {
        "name": "최단오",
        "position": "C",
        "bats": "R",
        "throws": "R",
        "firstYear": 1999,
        "lastYear": 2015,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1823,
          "PA": null,
          "AB": 5242,
          "H": 1445,
          "2B": 234,
          "3B": 8,
          "HR": 154,
          "RBI": 753,
          "R": 567,
          "BB": 473,
          "SO": 720,
          "SB": 13,
          "AVG": 0.276
        }
      },
      {
        "name": "우린초",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 2000,
        "lastYear": 2014,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 499,
          "GS": null,
          "W": 138,
          "L": 122,
          "SV": 3,
          "HLD": 7,
          "IP": 2167.2,
          "H": 2366,
          "ER": 1074,
          "BB": 724,
          "SO": 1436,
          "ERA": 4.46
        }
      },
      {
        "name": "지단겸",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 2004,
        "lastYear": 2020,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 421,
          "GS": null,
          "W": 135,
          "L": 105,
          "SV": 1,
          "HLD": 28,
          "IP": null,
          "H": null,
          "ER": null,
          "BB": null,
          "SO": null,
          "ERA": 4.23
        }
      },
      {
        "name": "최규일",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 1983,
        "lastYear": 1988,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 273,
          "GS": 205,
          "W": 124,
          "L": 73,
          "SV": 16,
          "HLD": null,
          "IP": 1577,
          "H": 1302,
          "ER": 547,
          "BB": 755,
          "SO": 931,
          "ERA": 3.12
        }
      }
    ],
    "records": [
      {
        "label": "최다 홈런",
        "holder": "장찬철",
        "year": 2003,
        "value": 56
      },
      {
        "label": "최다 타점",
        "holder": "브렛 웨일 2",
        "year": 2025,
        "value": 158
      },
      {
        "label": "최다 안타",
        "holder": "석윤욱",
        "year": 2016,
        "value": 195
      },
      {
        "label": "최고 타율(규정 타석)",
        "holder": "손보덕",
        "year": 1987,
        "value": 0.387
      },
      {
        "label": "최다승",
        "holder": "최규일",
        "year": 1985,
        "value": 25
      },
      {
        "label": "최다승",
        "holder": "배효람",
        "year": 1985,
        "value": 25
      },
      {
        "label": "최다 세이브",
        "holder": "장용형",
        "year": 2006,
        "value": 47
      },
      {
        "label": "최다 세이브",
        "holder": "장용형",
        "year": 2011,
        "value": 47
      },
      {
        "label": "최다 탈삼진",
        "holder": "최규일",
        "year": 1985,
        "value": 201
      },
      {
        "label": "최저 평균자책(규정 이닝)",
        "holder": "이름 미상",
        "year": null,
        "value": null
      }
    ]
  },
  {
    "clubId": 8,
    "firstSeason": 1982,
    "seasons": [
      {
        "year": 1982,
        "rank": 4,
        "wins": 38,
        "losses": 42,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 1983,
        "rank": 1,
        "wins": 55,
        "losses": 44,
        "ties": 1,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1984,
        "rank": 5,
        "wins": 43,
        "losses": 54,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 1985,
        "rank": 3,
        "wins": 57,
        "losses": 52,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 1986,
        "rank": 1,
        "wins": 67,
        "losses": 37,
        "ties": 4,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1987,
        "rank": 1,
        "wins": 55,
        "losses": 48,
        "ties": 5,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1988,
        "rank": 1,
        "wins": 68,
        "losses": 38,
        "ties": 2,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1989,
        "rank": 1,
        "wins": 65,
        "losses": 51,
        "ties": 4,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1990,
        "rank": 3,
        "wins": 68,
        "losses": 49,
        "ties": 3,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 1991,
        "rank": 1,
        "wins": 79,
        "losses": 42,
        "ties": 5,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1992,
        "rank": 3,
        "wins": 71,
        "losses": 54,
        "ties": 1,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 1993,
        "rank": 1,
        "wins": 81,
        "losses": 42,
        "ties": 3,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1994,
        "rank": 4,
        "wins": 65,
        "losses": 59,
        "ties": 2,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 1995,
        "rank": 4,
        "wins": 64,
        "losses": 58,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 1996,
        "rank": 1,
        "wins": 73,
        "losses": 51,
        "ties": 2,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1997,
        "rank": 1,
        "wins": 75,
        "losses": 50,
        "ties": 1,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1998,
        "rank": 5,
        "wins": 61,
        "losses": 64,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 1999,
        "rank": 7,
        "wins": 60,
        "losses": 69,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2000,
        "rank": 6,
        "wins": 57,
        "losses": 72,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 2001,
        "rank": 5,
        "wins": 60,
        "losses": 68,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 2002,
        "rank": 3,
        "wins": 78,
        "losses": 51,
        "ties": 4,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2003,
        "rank": 3,
        "wins": 78,
        "losses": 50,
        "ties": 5,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2004,
        "rank": 4,
        "wins": 67,
        "losses": 61,
        "ties": 5,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2005,
        "rank": 8,
        "wins": 49,
        "losses": 76,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2006,
        "rank": 4,
        "wins": 64,
        "losses": 59,
        "ties": 3,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2007,
        "rank": 8,
        "wins": 51,
        "losses": 74,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2008,
        "rank": 6,
        "wins": 57,
        "losses": 69,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2009,
        "rank": 1,
        "wins": 81,
        "losses": 48,
        "ties": 4,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2010,
        "rank": 5,
        "wins": 59,
        "losses": 74,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2011,
        "rank": 4,
        "wins": 70,
        "losses": 63,
        "ties": 0,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2012,
        "rank": 5,
        "wins": 62,
        "losses": 65,
        "ties": 6,
        "postseason": ""
      },
      {
        "year": 2013,
        "rank": 8,
        "wins": 51,
        "losses": 74,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2014,
        "rank": 8,
        "wins": 54,
        "losses": 74,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2015,
        "rank": 7,
        "wins": 67,
        "losses": 77,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2016,
        "rank": 5,
        "wins": 70,
        "losses": 73,
        "ties": 1,
        "postseason": "와일드카드 탈락"
      },
      {
        "year": 2017,
        "rank": 1,
        "wins": 87,
        "losses": 56,
        "ties": 1,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2018,
        "rank": 5,
        "wins": 70,
        "losses": 74,
        "ties": 0,
        "postseason": "와일드카드 탈락"
      },
      {
        "year": 2019,
        "rank": 7,
        "wins": 62,
        "losses": 80,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2020,
        "rank": 6,
        "wins": 73,
        "losses": 71,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2021,
        "rank": 9,
        "wins": 58,
        "losses": 76,
        "ties": 10,
        "postseason": ""
      },
      {
        "year": 2022,
        "rank": 5,
        "wins": 70,
        "losses": 73,
        "ties": 1,
        "postseason": "와일드카드 탈락"
      },
      {
        "year": 2023,
        "rank": 6,
        "wins": 73,
        "losses": 69,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2024,
        "rank": 1,
        "wins": 87,
        "losses": 55,
        "ties": 2,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2025,
        "rank": 8,
        "wins": 65,
        "losses": 75,
        "ties": 4,
        "postseason": ""
      }
    ],
    "regularSeasonFirst": [
      1988,
      1991,
      1993,
      1996,
      1997,
      2009,
      2017,
      2024
    ],
    "legends": [
      {
        "name": "송정일",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 1985,
        "lastYear": 1995,
        "retiredNumber": 18,
        "isPitcher": true,
        "career": {
          "G": 367,
          "GS": 109,
          "W": 146,
          "L": 40,
          "SV": 132,
          "HLD": null,
          "IP": 1647,
          "H": 968,
          "ER": 220,
          "BB": 342,
          "SO": 1698,
          "ERA": 1.2
        }
      },
      {
        "name": "엄단겸",
        "position": "SS",
        "bats": "R",
        "throws": "R",
        "firstYear": 1993,
        "lastYear": 2011,
        "retiredNumber": 7,
        "isPitcher": false,
        "career": {
          "G": 1706,
          "PA": 6921,
          "AB": 6060,
          "H": 1797,
          "2B": 340,
          "3B": 29,
          "HR": 194,
          "RBI": 730,
          "R": 1100,
          "BB": 634,
          "SO": 622,
          "SB": 510,
          "AVG": 0.297
        }
      },
      {
        "name": "허래담",
        "position": "1B",
        "bats": "R",
        "throws": "R",
        "firstYear": 1982,
        "lastYear": 1995,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1338,
          "PA": 5502,
          "AB": 4850,
          "H": 1389,
          "2B": 247,
          "3B": 14,
          "HR": 207,
          "RBI": 781,
          "R": 762,
          "BB": 483,
          "SO": 696,
          "SB": 143,
          "AVG": 0.286
        }
      },
      {
        "name": "오규엽",
        "position": "P",
        "bats": "L",
        "throws": "L",
        "firstYear": 2007,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": null,
          "GS": null,
          "W": 186,
          "L": 127,
          "SV": null,
          "HLD": null,
          "IP": null,
          "H": null,
          "ER": null,
          "BB": null,
          "SO": 2185,
          "ERA": 3.9
        }
      },
      {
        "name": "나린탄",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 1989,
        "lastYear": 2005,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 602,
          "GS": 265,
          "W": 152,
          "L": 112,
          "SV": 53,
          "HLD": 33,
          "IP": 2204.2,
          "H": 1771,
          "ER": 806,
          "BB": 797,
          "SO": 1749,
          "ERA": 3.29
        }
      },
      {
        "name": "차아항",
        "position": "1B",
        "bats": "L",
        "throws": "L",
        "firstYear": 1996,
        "lastYear": 2010,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 2064,
          "PA": 8344,
          "AB": 7084,
          "H": 2100,
          "2B": 394,
          "3B": 18,
          "HR": 221,
          "RBI": 1043,
          "R": 1008,
          "BB": 1101,
          "SO": 879,
          "SB": 99,
          "AVG": 0.296
        }
      },
      {
        "name": "한수직",
        "position": "CF",
        "bats": "R",
        "throws": "R",
        "firstYear": 1985,
        "lastYear": 1997,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1388,
          "PA": 5522,
          "AB": 4775,
          "H": 1252,
          "2B": 217,
          "3B": 30,
          "HR": 145,
          "RBI": 612,
          "R": 768,
          "BB": 544,
          "SO": 687,
          "SB": 371,
          "AVG": 0.262
        }
      },
      {
        "name": "지훈화",
        "position": "1B",
        "bats": "R",
        "throws": "R",
        "firstYear": 1982,
        "lastYear": 1988,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 630,
          "PA": 2438,
          "AB": 2145,
          "H": 596,
          "2B": 84,
          "3B": 8,
          "HR": 110,
          "RBI": 334,
          "R": 311,
          "BB": 241,
          "SO": 187,
          "SB": 24,
          "AVG": 0.278
        }
      },
      {
        "name": "유윤종",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 2005,
        "lastYear": 2019,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 398,
          "GS": 144,
          "W": 77,
          "L": 75,
          "SV": 86,
          "HLD": 18,
          "IP": 1270,
          "H": 1168,
          "ER": 464,
          "BB": 387,
          "SO": 1072,
          "ERA": 3.29
        }
      },
      {
        "name": "안율배",
        "position": "3B",
        "bats": "R",
        "throws": "R",
        "firstYear": 1986,
        "lastYear": 1993,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1331,
          "PA": 4982,
          "AB": 4264,
          "H": 1190,
          "2B": 199,
          "3B": 20,
          "HR": 163,
          "RBI": 712,
          "R": 610,
          "BB": 608,
          "SO": 567,
          "SB": 79,
          "AVG": 0.279
        }
      }
    ],
    "records": [
      {
        "label": "최다 홈런",
        "holder": "닐 크로퍼드 2",
        "year": 1999,
        "value": 40
      },
      {
        "label": "최다 타점",
        "holder": "추시길",
        "year": 2009,
        "value": 127
      },
      {
        "label": "최다 안타",
        "holder": "엄단겸",
        "year": 1994,
        "value": 196
      },
      {
        "label": "최고 타율(규정 타석)",
        "holder": "엄단겸",
        "year": 1994,
        "value": 0.393
      },
      {
        "label": "최다승",
        "holder": "송정일",
        "year": 1986,
        "value": 24
      },
      {
        "label": "최다 세이브",
        "holder": "장완룡",
        "year": 1998,
        "value": 34
      },
      {
        "label": "최다 세이브",
        "holder": "윤세방",
        "year": 2021,
        "value": 34
      },
      {
        "label": "최다 탈삼진",
        "holder": "송정일",
        "year": 1986,
        "value": 214
      },
      {
        "label": "최저 평균자책(규정 이닝)",
        "holder": "송정일",
        "year": 1993,
        "value": 0.78
      }
    ]
  },
  {
    "clubId": 9,
    "firstSeason": 2013,
    "seasons": [
      {
        "year": 2013,
        "rank": 7,
        "wins": 52,
        "losses": 72,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 2014,
        "rank": 3,
        "wins": 70,
        "losses": 57,
        "ties": 1,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2015,
        "rank": 3,
        "wins": 84,
        "losses": 57,
        "ties": 3,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2016,
        "rank": 2,
        "wins": 83,
        "losses": 58,
        "ties": 3,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2017,
        "rank": 4,
        "wins": 79,
        "losses": 62,
        "ties": 3,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2018,
        "rank": 10,
        "wins": 58,
        "losses": 85,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2019,
        "rank": 5,
        "wins": 73,
        "losses": 69,
        "ties": 2,
        "postseason": "와일드카드 탈락"
      },
      {
        "year": 2020,
        "rank": 1,
        "wins": 83,
        "losses": 55,
        "ties": 6,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 2021,
        "rank": 7,
        "wins": 67,
        "losses": 68,
        "ties": 9,
        "postseason": ""
      },
      {
        "year": 2022,
        "rank": 6,
        "wins": 67,
        "losses": 74,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2023,
        "rank": 4,
        "wins": 75,
        "losses": 67,
        "ties": 2,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2024,
        "rank": 9,
        "wins": 61,
        "losses": 81,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2025,
        "rank": 5,
        "wins": 71,
        "losses": 67,
        "ties": 6,
        "postseason": "와일드카드 탈락"
      }
    ],
    "regularSeasonFirst": [
      2020
    ],
    "legends": [
      {
        "name": "윤무학",
        "position": "2B",
        "bats": "L",
        "throws": "R",
        "firstYear": 2013,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1400,
          "PA": null,
          "AB": 5029,
          "H": 1604,
          "2B": 264,
          "3B": 64,
          "HR": 42,
          "RBI": 555,
          "R": 921,
          "BB": 546,
          "SO": 741,
          "SB": 303,
          "AVG": 0.319
        }
      },
      {
        "name": "문훈규",
        "position": "RF",
        "bats": "L",
        "throws": "L",
        "firstYear": 2013,
        "lastYear": 2021,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1467,
          "PA": null,
          "AB": 5679,
          "H": 1770,
          "2B": 357,
          "3B": 30,
          "HR": 282,
          "RBI": 1100,
          "R": 1038,
          "BB": 535,
          "SO": 1412,
          "SB": 100,
          "AVG": 0.312
        }
      },
      {
        "name": "조태영",
        "position": "C",
        "bats": "R",
        "throws": "R",
        "firstYear": 2019,
        "lastYear": 2022,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1963,
          "PA": null,
          "AB": 6358,
          "H": 1968,
          "2B": 353,
          "3B": 12,
          "HR": 282,
          "RBI": 1195,
          "R": 932,
          "BB": 718,
          "SO": 820,
          "SB": 60,
          "AVG": 0.31
        }
      },
      {
        "name": "백창욱",
        "position": "3B",
        "bats": "R",
        "throws": "R",
        "firstYear": 2016,
        "lastYear": 2023,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1697,
          "PA": null,
          "AB": 5363,
          "H": 1537,
          "2B": 271,
          "3B": 10,
          "HR": 269,
          "RBI": 1041,
          "R": 882,
          "BB": 857,
          "SO": 1145,
          "SB": 23,
          "AVG": 0.287
        }
      },
      {
        "name": "최온록",
        "position": "1B",
        "bats": "R",
        "throws": "R",
        "firstYear": 2013,
        "lastYear": 2017,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 2053,
          "PA": null,
          "AB": 6663,
          "H": 1880,
          "2B": 346,
          "3B": 17,
          "HR": 337,
          "RBI": 1265,
          "R": 943,
          "BB": 795,
          "SO": 1307,
          "SB": 59,
          "AVG": 0.282
        }
      },
      {
        "name": "칼 데이비슨 3",
        "position": "1B",
        "bats": "L",
        "throws": "R",
        "firstYear": 2014,
        "lastYear": 2016,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 390,
          "PA": 1638,
          "AB": 1351,
          "H": 472,
          "2B": 102,
          "3B": 14,
          "HR": 124,
          "RBI": 382,
          "R": 343,
          "BB": 235,
          "SO": 293,
          "SB": 64,
          "AVG": 0.349
        }
      },
      {
        "name": "차창담",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 2013,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 306,
          "GS": null,
          "W": 85,
          "L": 88,
          "SV": 1,
          "HLD": 1,
          "IP": 1424.1,
          "H": 1400,
          "ER": 728,
          "BB": 609,
          "SO": 1205,
          "ERA": 4.6
        }
      },
      {
        "name": "민진웅",
        "position": "P",
        "bats": "L",
        "throws": "L",
        "firstYear": 2016,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 178,
          "GS": null,
          "W": 48,
          "L": 37,
          "SV": 0,
          "HLD": 4,
          "IP": 694.2,
          "H": 644,
          "ER": 282,
          "BB": 246,
          "SO": 699,
          "ERA": 3.65
        }
      },
      {
        "name": "숀 맥케이 3",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 2019,
        "lastYear": 2022,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 121,
          "GS": null,
          "W": 53,
          "L": 36,
          "SV": 0,
          "HLD": 0,
          "IP": 732.2,
          "H": 681,
          "ER": 249,
          "BB": 191,
          "SO": 657,
          "ERA": 3.06
        }
      },
      {
        "name": "숀 맥케이 4",
        "position": "P",
        "bats": null,
        "throws": "R",
        "firstYear": 2013,
        "lastYear": 2017,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 151,
          "GS": null,
          "W": 61,
          "L": 37,
          "SV": 0,
          "HLD": 0,
          "IP": 935.2,
          "H": 883,
          "ER": 382,
          "BB": 238,
          "SO": 675,
          "ERA": 3.67
        }
      }
    ],
    "records": [
      {
        "label": "최다 홈런",
        "holder": "칼 데이비슨 3",
        "year": 2015,
        "value": 47
      },
      {
        "label": "최다 타점",
        "holder": "칼 데이비슨 3",
        "year": 2015,
        "value": 140
      },
      {
        "label": "최다 안타",
        "holder": "신경목",
        "year": 2023,
        "value": 187
      },
      {
        "label": "최고 타율(규정 타석)",
        "holder": "칼 데이비슨 3",
        "year": 2015,
        "value": 0.381
      },
      {
        "label": "최다승",
        "holder": "로건 하퍼 3",
        "year": 2023,
        "value": 20
      },
      {
        "label": "최다 세이브",
        "holder": "장무춘",
        "year": 2015,
        "value": 31
      },
      {
        "label": "최다 세이브",
        "holder": "오진영",
        "year": 2019,
        "value": 31
      },
      {
        "label": "최다 탈삼진",
        "holder": "피트 갤러거 3",
        "year": 2025,
        "value": 216
      },
      {
        "label": "최저 평균자책(규정 이닝)",
        "holder": "로건 하퍼 3",
        "year": 2023,
        "value": 2
      }
    ]
  },
  {
    "clubId": 10,
    "firstSeason": 1982,
    "seasons": [
      {
        "year": 1982,
        "rank": 5,
        "wins": 31,
        "losses": 49,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 1983,
        "rank": 6,
        "wins": 43,
        "losses": 56,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 1984,
        "rank": 1,
        "wins": 50,
        "losses": 48,
        "ties": 2,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1985,
        "rank": 2,
        "wins": 59,
        "losses": 51,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 1986,
        "rank": 5,
        "wins": 50,
        "losses": 52,
        "ties": 6,
        "postseason": ""
      },
      {
        "year": 1987,
        "rank": 3,
        "wins": 54,
        "losses": 49,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 1988,
        "rank": 3,
        "wins": 57,
        "losses": 49,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 1989,
        "rank": 7,
        "wins": 48,
        "losses": 67,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 1990,
        "rank": 6,
        "wins": 44,
        "losses": 71,
        "ties": 5,
        "postseason": ""
      },
      {
        "year": 1991,
        "rank": 4,
        "wins": 61,
        "losses": 62,
        "ties": 3,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 1992,
        "rank": 1,
        "wins": 71,
        "losses": 55,
        "ties": 0,
        "postseason": "한국시리즈 우승"
      },
      {
        "year": 1993,
        "rank": 6,
        "wins": 62,
        "losses": 63,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 1994,
        "rank": 6,
        "wins": 56,
        "losses": 67,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 1995,
        "rank": 2,
        "wins": 68,
        "losses": 53,
        "ties": 5,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 1996,
        "rank": 5,
        "wins": 57,
        "losses": 63,
        "ties": 6,
        "postseason": ""
      },
      {
        "year": 1997,
        "rank": 8,
        "wins": 48,
        "losses": 77,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 1998,
        "rank": 8,
        "wins": 50,
        "losses": 72,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 1999,
        "rank": 2,
        "wins": 75,
        "losses": 52,
        "ties": 5,
        "postseason": "한국시리즈 준우승"
      },
      {
        "year": 2000,
        "rank": 5,
        "wins": 65,
        "losses": 64,
        "ties": 4,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2001,
        "rank": 8,
        "wins": 59,
        "losses": 70,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 2002,
        "rank": 8,
        "wins": 35,
        "losses": 97,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2003,
        "rank": 8,
        "wins": 39,
        "losses": 91,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2004,
        "rank": 8,
        "wins": 50,
        "losses": 72,
        "ties": 11,
        "postseason": ""
      },
      {
        "year": 2005,
        "rank": 5,
        "wins": 58,
        "losses": 67,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2006,
        "rank": 7,
        "wins": 50,
        "losses": 73,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2007,
        "rank": 7,
        "wins": 55,
        "losses": 68,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2008,
        "rank": 3,
        "wins": 69,
        "losses": 57,
        "ties": 0,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2009,
        "rank": 4,
        "wins": 66,
        "losses": 67,
        "ties": 0,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2010,
        "rank": 4,
        "wins": 69,
        "losses": 61,
        "ties": 3,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2011,
        "rank": 3,
        "wins": 72,
        "losses": 56,
        "ties": 5,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2012,
        "rank": 4,
        "wins": 65,
        "losses": 62,
        "ties": 6,
        "postseason": "플레이오프 탈락"
      },
      {
        "year": 2013,
        "rank": 5,
        "wins": 66,
        "losses": 58,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 2014,
        "rank": 7,
        "wins": 59,
        "losses": 68,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2015,
        "rank": 8,
        "wins": 66,
        "losses": 77,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2016,
        "rank": 8,
        "wins": 66,
        "losses": 78,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2017,
        "rank": 3,
        "wins": 80,
        "losses": 62,
        "ties": 2,
        "postseason": "준플레이오프 탈락"
      },
      {
        "year": 2018,
        "rank": 7,
        "wins": 68,
        "losses": 74,
        "ties": 2,
        "postseason": ""
      },
      {
        "year": 2019,
        "rank": 10,
        "wins": 48,
        "losses": 93,
        "ties": 3,
        "postseason": ""
      },
      {
        "year": 2020,
        "rank": 7,
        "wins": 71,
        "losses": 72,
        "ties": 1,
        "postseason": ""
      },
      {
        "year": 2021,
        "rank": 8,
        "wins": 65,
        "losses": 71,
        "ties": 8,
        "postseason": ""
      },
      {
        "year": 2022,
        "rank": 8,
        "wins": 64,
        "losses": 76,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 2023,
        "rank": 7,
        "wins": 68,
        "losses": 76,
        "ties": 0,
        "postseason": ""
      },
      {
        "year": 2024,
        "rank": 7,
        "wins": 66,
        "losses": 74,
        "ties": 4,
        "postseason": ""
      },
      {
        "year": 2025,
        "rank": 7,
        "wins": 66,
        "losses": 72,
        "ties": 6,
        "postseason": ""
      }
    ],
    "regularSeasonFirst": [],
    "legends": [
      {
        "name": "이휘춘",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 1983,
        "lastYear": 1988,
        "retiredNumber": 11,
        "isPitcher": true,
        "career": {
          "G": 248,
          "GS": 124,
          "W": 103,
          "L": 74,
          "SV": 26,
          "HLD": 0,
          "IP": 1414.2,
          "H": 1249,
          "ER": 387,
          "BB": 372,
          "SO": 1019,
          "ERA": 2.46
        }
      },
      {
        "name": "고세엽",
        "position": "1B",
        "bats": "R",
        "throws": "R",
        "firstYear": 2001,
        "lastYear": 2022,
        "retiredNumber": 10,
        "isPitcher": false,
        "career": {
          "G": 1971,
          "PA": 8128,
          "AB": 7118,
          "H": 2199,
          "2B": 331,
          "3B": 6,
          "HR": 374,
          "RBI": 1425,
          "R": 972,
          "BB": 746,
          "SO": 1025,
          "SB": 11,
          "AVG": 0.309
        }
      },
      {
        "name": "원나중",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 1986,
        "lastYear": 1997,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 308,
          "GS": 231,
          "W": 117,
          "L": 94,
          "SV": 10,
          "HLD": 0,
          "IP": 1863.2,
          "H": 1851,
          "ER": 689,
          "BB": 487,
          "SO": 916,
          "ERA": 3.33
        }
      },
      {
        "name": "현나직",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 1992,
        "lastYear": 2008,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 356,
          "GS": 291,
          "W": 93,
          "L": 133,
          "SV": 14,
          "HLD": 3,
          "IP": 1791.1,
          "H": 1819,
          "ER": 748,
          "BB": 476,
          "SO": 1016,
          "ERA": 3.76
        }
      },
      {
        "name": "윤연록",
        "position": "P",
        "bats": "L",
        "throws": "L",
        "firstYear": 1994,
        "lastYear": 2007,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 386,
          "GS": null,
          "W": 87,
          "L": 82,
          "SV": 9,
          "HLD": 22,
          "IP": 1524.1,
          "H": 1448,
          "ER": 648,
          "BB": null,
          "SO": 1209,
          "ERA": 3.83
        }
      },
      {
        "name": "서한람",
        "position": "P",
        "bats": "R",
        "throws": "R",
        "firstYear": 1997,
        "lastYear": 2011,
        "retiredNumber": null,
        "isPitcher": true,
        "career": {
          "G": 388,
          "GS": 260,
          "W": 123,
          "L": 88,
          "SV": 22,
          "HLD": 12,
          "IP": 1743.1,
          "H": 1719,
          "ER": 687,
          "BB": 492,
          "SO": 968,
          "ERA": 3.55
        }
      },
      {
        "name": "손동술",
        "position": "2B",
        "bats": "R",
        "throws": "R",
        "firstYear": 1991,
        "lastYear": 2004,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1167,
          "PA": 4458,
          "AB": 3857,
          "H": 1141,
          "2B": 228,
          "3B": 23,
          "HR": 85,
          "RBI": 638,
          "R": 531,
          "BB": 475,
          "SO": 416,
          "SB": 22,
          "AVG": 0.296
        }
      },
      {
        "name": "도우교",
        "position": "LF",
        "bats": "R",
        "throws": "R",
        "firstYear": 2008,
        "lastYear": 2025,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 1839,
          "PA": null,
          "AB": 6872,
          "H": 2056,
          "2B": 412,
          "3B": 26,
          "HR": 221,
          "RBI": 1040,
          "R": 1103,
          "BB": 646,
          "SO": 1157,
          "SB": 138,
          "AVG": 0.299
        }
      },
      {
        "name": "신경목",
        "position": "RF",
        "bats": "L",
        "throws": "R",
        "firstYear": 2007,
        "lastYear": 2021,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 2169,
          "PA": null,
          "AB": 8205,
          "H": 2618,
          "2B": 463,
          "3B": 37,
          "HR": 182,
          "RBI": 1086,
          "R": 1400,
          "BB": 962,
          "SO": 1336,
          "SB": 232,
          "AVG": 0.319
        }
      },
      {
        "name": "남원화",
        "position": "C",
        "bats": "R",
        "throws": "R",
        "firstYear": 2004,
        "lastYear": 2017,
        "retiredNumber": null,
        "isPitcher": false,
        "career": {
          "G": 2496,
          "PA": null,
          "AB": 8032,
          "H": 2222,
          "2B": 397,
          "3B": 13,
          "HR": 350,
          "RBI": 1313,
          "R": 1006,
          "BB": 841,
          "SO": 1598,
          "SB": 34,
          "AVG": 0.277
        }
      }
    ],
    "records": [
      {
        "label": "최다 홈런",
        "holder": "고세엽",
        "year": 2010,
        "value": 44
      },
      {
        "label": "최다 타점",
        "holder": "고세엽",
        "year": 2010,
        "value": 133
      },
      {
        "label": "최다 안타",
        "holder": "피트 갤러거",
        "year": 2024,
        "value": 202
      },
      {
        "label": "최고 타율(규정 타석)",
        "holder": "석기림",
        "year": 1999,
        "value": 0.372
      },
      {
        "label": "최다승",
        "holder": "이휘춘",
        "year": 1984,
        "value": 27
      },
      {
        "label": "최다 세이브",
        "holder": "오헌철",
        "year": 2017,
        "value": 37
      },
      {
        "label": "최다 탈삼진",
        "holder": "이휘춘",
        "year": 1984,
        "value": 223
      },
      {
        "label": "최저 평균자책(규정 이닝)",
        "holder": "이휘춘",
        "year": 1986,
        "value": 1.55
      }
    ]
  }
];
