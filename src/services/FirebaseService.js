import { db as firestore } from '../config/firebase';
import Logger from '../utils/Logger';

// Generic Firebase service class for CRUD operations
class FirebaseService {
  // Create a new document
  static async create(collectionName, data) {
    try {
      const docRef = await db.collection(collectionName).add({
        ...data,
        createdAt: firestore.FieldValue.serverTimestamp(),
        updatedAt: firestore.FieldValue.serverTimestamp()
      });
      Logger.firebase(`Created document in ${collectionName}`, { id: docRef.id });
      return { success: true, id: docRef.id };
    } catch (error) {
      Logger.error('firebase', `Error creating document in ${collectionName}:`, error);
      return { success: false, error };
    }
  }

  // Read a single document
  static async read(collectionName, docId) {
    try {
      const docRef = db.collection(collectionName).doc(docId);
      const docSnap = await docRef.get();
      
      if (docSnap.exists) {
        return { success: true, data: { id: docSnap.id, ...docSnap.data() } };
      } else {
        return { success: false, error: 'Document not found' };
      }
    } catch (error) {
      Logger.error('firebase', `Error reading document ${collectionName}/${docId}:`, error);
      return { success: false, error };
    }
  }

  // Update a document
  static async update(collectionName, docId, data) {
    try {
      const docRef = db.collection(collectionName).doc(docId);
      await docRef.update({
        ...data,
        updatedAt: firestore.FieldValue.serverTimestamp()
      });
      Logger.firebase(`Updated document ${collectionName}/${docId}`);
      return { success: true };
    } catch (error) {
      Logger.error('firebase', `Error updating document ${collectionName}/${docId}:`, error);
      return { success: false, error };
    }
  }

  // Delete a document
  static async delete(collectionName, docId) {
    try {
      await db.collection(collectionName).doc(docId).delete();
      Logger.firebase(`Deleted document ${collectionName}/${docId}`);
      return { success: true };
    } catch (error) {
      Logger.error('firebase', `Error deleting document ${collectionName}/${docId}:`, error);
      return { success: false, error };
    }
  }

  // Query documents with filters
  static async query(collectionName, filters = [], orderByField = null, limitCount = null) {
    try {
      let ref = db.collection(collectionName);
      
      // Apply filters
      filters.forEach(filter => {
        ref = ref.where(filter.field, filter.operator, filter.value);
      });
      
      // Apply ordering
      if (orderByField) {
        ref = ref.orderBy(orderByField.field, orderByField.direction || 'asc');
      }
      
      // Apply limit
      if (limitCount) {
        ref = ref.limit(limitCount);
      }
      
      const snapshot = await ref.get();
      const documents = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      
      Logger.firebase(`Queried ${collectionName}`, { count: documents.length });
      return { success: true, data: documents };
    } catch (error) {
      Logger.error('firebase', `Error querying ${collectionName}:`, error);
      return { success: false, error };
    }
  }

  // Subscribe to document changes
  static subscribe(collectionName, docId, callback) {
    const docRef = db.collection(collectionName).doc(docId);
    return docRef.onSnapshot(
      (snapshot) => {
        if (snapshot.exists) {
          callback({ success: true, data: { id: snapshot.id, ...snapshot.data() } });
        } else {
          callback({ success: false, error: 'Document not found' });
        }
      },
      (error) => {
        Logger.error('firebase', `Error in subscription ${collectionName}/${docId}:`, error);
        callback({ success: false, error });
      }
    );
  }

  // Subscribe to collection changes
  static subscribeToCollection(collectionName, filters = [], orderByField = null, limitCount = null, callback) {
    try {
      let ref = db.collection(collectionName);
      
      // Apply filters
      filters.forEach(filter => {
        ref = ref.where(filter.field, filter.operator, filter.value);
      });
      
      // Apply ordering
      if (orderByField) {
        ref = ref.orderBy(orderByField.field, orderByField.direction || 'asc');
      }
      
      // Apply limit
      if (limitCount) {
        ref = ref.limit(limitCount);
      }
      
      return ref.onSnapshot(
        (snapshot) => {
          const documents = snapshot.docs.map(d => ({
            id: d.id,
            ...d.data()
          }));
          callback({ success: true, data: documents });
        },
        (error) => {
          Logger.error('firebase', `Error in collection subscription ${collectionName}:`, error);
          callback({ success: false, error });
        }
      );
    } catch (error) {
      Logger.error('firebase', `Error setting up collection subscription ${collectionName}:`, error);
      callback({ success: false, error });
    }
  }

  // Increment a numeric field
  static async incrementField(collectionName, docId, field, value = 1) {
    try {
      const docRef = db.collection(collectionName).doc(docId);
      await docRef.update({
        [field]: firestore.FieldValue.increment(value),
        updatedAt: firestore.FieldValue.serverTimestamp()
      });
      return { success: true };
    } catch (error) {
      Logger.error('firebase', `Error incrementing field ${field} in ${collectionName}/${docId}:`, error);
      return { success: false, error };
    }
  }

  // Add to array field
  static async addToArray(collectionName, docId, field, value) {
    try {
      const docRef = db.collection(collectionName).doc(docId);
      await docRef.update({
        [field]: firestore.FieldValue.arrayUnion(value),
        updatedAt: firestore.FieldValue.serverTimestamp()
      });
      return { success: true };
    } catch (error) {
      Logger.error('firebase', `Error adding to array ${field} in ${collectionName}/${docId}:`, error);
      return { success: false, error };
    }
  }

  // Remove from array field
  static async removeFromArray(collectionName, docId, field, value) {
    try {
      const docRef = db.collection(collectionName).doc(docId);
      await docRef.update({
        [field]: firestore.FieldValue.arrayRemove(value),
        updatedAt: firestore.FieldValue.serverTimestamp()
      });
      return { success: true };
    } catch (error) {
      Logger.error('firebase', `Error removing from array ${field} in ${collectionName}/${docId}:`, error);
      return { success: false, error };
    }
  }
}

export default FirebaseService;