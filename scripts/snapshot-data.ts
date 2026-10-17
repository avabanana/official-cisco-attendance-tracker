/** Lossless read-only export classification. Never guesses or repairs identities. */
export function snapshotRecords(documents: Array<{ id: string; data: () => Record<string, any> }>, activeGeneration?: string) {
  const recordsByDate: Record<string, Record<string, any>> = Object.create(null);
  const rawRecords: Array<{ documentId: string; data: Record<string, any>; classification: string; issues: string[] }> = [];
  for (const document of documents) {
    const data = document.data();
    const issues: string[] = [];
    const validDate = typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date)
      && Number.isFinite(Date.parse(data.date)) && new Date(data.date).toISOString().slice(0, 10) === data.date;
    if (!validDate) issues.push('Missing or invalid date');
    if (typeof data.studentId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.studentId)) issues.push('Missing or invalid studentId');
    if (document.id !== `${data.date}_${data.studentId}`) issues.push('Document ID does not match date/studentId');
    if (data.id !== document.id) issues.push('Stored record ID does not match document ID');
    if (!['absent', 'checked_in', 'completed'].includes(data.status)) issues.push('Missing or invalid attendance status');
    const archived = !!activeGeneration && data.storageGeneration !== activeGeneration;
    const classification = archived ? 'archived' : issues.length ? 'quarantined' : 'active';
    rawRecords.push({ documentId: document.id, data, classification, issues });
    if (classification === 'active') (recordsByDate[data.date] ||= Object.create(null))[data.studentId] = data;
  }
  return {
    recordsByDate, rawRecords,
    quarantinedRecords: rawRecords.filter(record => record.classification === 'quarantined'),
    exportSummary: {
      totalDocuments: rawRecords.length,
      activeDocuments: rawRecords.filter(record => record.classification === 'active').length,
      archivedDocuments: rawRecords.filter(record => record.classification === 'archived').length,
      quarantinedDocuments: rawRecords.filter(record => record.classification === 'quarantined').length,
    },
  };
}
