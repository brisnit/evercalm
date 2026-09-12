import { z } from 'zod'

/** IANA timezone names the pilot needs. Extended as customers arrive. */
export const SUPPORTED_TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/New_York',
  'America/Anchorage',
  'Pacific/Honolulu',
] as const

export const createLocationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Give the location a name of at least 2 characters')
    .max(80, 'Location names are limited to 80 characters'),
  timezone: z.enum(SUPPORTED_TIMEZONES, {
    message: 'Choose a timezone so shift times are correct at this location',
  }),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  region: z.string().trim().max(80).optional().or(z.literal('')),
})

export type CreateLocationInput = z.infer<typeof createLocationSchema>
