import rawTaxonomy from "@/data/course-topics.json";

export type CourseId = keyof typeof rawTaxonomy;
export const COURSE_TOPICS = rawTaxonomy;
export const COURSE_IDS = Object.keys(COURSE_TOPICS) as CourseId[];
export const COURSE_NAMES = Object.fromEntries(
  COURSE_IDS.map((id) => [id, COURSE_TOPICS[id].name]),
) as Record<CourseId, string>;

export function isCourse(value: string): value is CourseId {
  return COURSE_IDS.includes(value as CourseId);
}

export function topicsForCourse(course: string) {
  return isCourse(course) ? COURSE_TOPICS[course].topics : [];
}

export function isTopicForCourse(course: string, topic: string) {
  return topicsForCourse(course).includes(topic);
}
