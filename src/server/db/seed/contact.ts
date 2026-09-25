import type { SeedPerson } from './data'

/**
 * Contact details for seeded people.
 *
 * A demo where every phone field is empty makes the product look unfinished
 * and hides the work: a manager's whole reason for opening someone's record is
 * to find a number. These are derived from the person's key, so the same
 * person has the same details on every machine and in every screenshot, and
 * the numbers all sit in the 555-01xx range reserved for fiction.
 */

/** Stable small integer from a string, so a seed run is reproducible. */
function hash(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

// Ordinary names, and never a surname already used by a seeded employee, so an
// emergency contact never reads as another person in the directory.
const FIRST = [
  'Rosa',
  'Daniel',
  'Yvonne',
  'Hector',
  'Margaret',
  'Tobias',
  'Leilani',
  'Grant',
  'Farah',
  'Nadine',
  'Oscar',
  'Ruth',
]
const LAST = [
  'Alvarez',
  'Coleman',
  'Petrov',
  'Ahmed',
  'Byrne',
  'Suzuki',
  'Kaur',
  'Mbeki',
  'Halvorsen',
  'Quintero',
]
const RELATION = ['Partner', 'Mother', 'Father', 'Sister', 'Brother', 'Spouse', 'Friend']

export interface SeedContact {
  phone: string
  dateOfBirth: string
  emergencyContactName: string
  emergencyContactPhone: string
}

export function seedContact(person: SeedPerson, areaCode: string): SeedContact {
  const h = hash(person.key)
  const line = 100 + (h % 90)
  const iceLine = 100 + ((h >> 7) % 90)
  const name = `${FIRST[h % FIRST.length]} ${LAST[(h >> 3) % LAST.length]}`
  const relation = RELATION[(h >> 5) % RELATION.length]

  // Everyone is comfortably an adult, spread across about thirty years.
  const year = 1968 + (h % 32)
  const month = String(1 + ((h >> 4) % 12)).padStart(2, '0')
  const day = String(1 + ((h >> 9) % 28)).padStart(2, '0')

  return {
    phone: `(${areaCode}) 555-0${line}`,
    dateOfBirth: `${year}-${month}-${day}`,
    emergencyContactName: `${name} (${relation})`,
    emergencyContactPhone: `(${areaCode}) 555-0${iceLine}`,
  }
}
