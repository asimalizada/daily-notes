export interface Note {
  id: string;
  title: string;
  dateISO: string;
  contentHtml: string;
  imageDataUrls?: string[];
  isImportant: boolean;
  createdAt: number;
  updatedAt: number;
}
