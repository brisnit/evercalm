/**
 * WHEN A MESSAGE MAY IGNORE SOMEBODY'S NOTIFICATION SETTINGS.
 *
 * Two different questions, answered separately on purpose:
 *
 *   overridesPreferences   May it reach somebody who switched this category
 *                          off? (It still waits for quiet hours unless the
 *                          next answer is also yes.)
 *   overridesQuietHours    May it arrive NOW, during their quiet hours?
 *
 * Until this slice's review, both were "yes" for anything that required
 * acknowledgement. That was wrong in a way that matters: "please confirm you
 * have read the new rota process" would buzz a phone at 3am. Needing a
 * confirmation is a reason to keep a message visible - it is pinned in the
 * inbox and on the home screen until confirmed - not a reason to interrupt.
 *
 * THE POLICY
 *
 *   overridesPreferences = category.overridesPreferences  (Safety, HR, Emergency)
 *                        OR priority = emergency
 *
 *   overridesQuietHours  = priority = emergency
 *                        OR (priority = urgent AND category.overridesPreferences)
 *
 * Requiring acknowledgement contributes to NEITHER.
 *
 * Both overrides are only reachable through explicit authorization: emergency
 * needs `announcement.publish_emergency`, urgent needs
 * `announcement.publish_urgent`, and which categories override preferences is
 * an organization setting on the category row rather than an author's
 * checkbox. So nothing interrupts somebody's night by accident or by habit.
 *
 * Nothing is ever DROPPED. A message held for quiet hours is delivered when
 * the window ends; a category somebody muted still lands in their inbox and
 * is recorded as a suppressed notification.
 */

export interface DeliveryPolicyInput {
  priority: string
  requiresAcknowledgement: boolean
}

export interface DeliveryPolicyCategory {
  overridesPreferences: boolean
}

export interface DeliveryPolicy {
  overridesPreferences: boolean
  overridesQuietHours: boolean
}

export function deliveryPolicy(
  announcement: DeliveryPolicyInput,
  category: DeliveryPolicyCategory,
): DeliveryPolicy {
  const emergency = announcement.priority === 'emergency'
  const urgent = announcement.priority === 'urgent'

  return {
    overridesPreferences: emergency || category.overridesPreferences,
    overridesQuietHours: emergency || (urgent && category.overridesPreferences),
  }
}
