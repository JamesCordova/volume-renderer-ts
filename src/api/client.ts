/**
 * Cliente del backend de Axial (api-repo). Deliberadamente sin dependencia de
 * `localStorage`/DOM aca -- recibe el token como parametro en vez de leerlo
 * de un storage global, para poder probarlo desde Node (sin navegador) y
 * para que quien lo llama (App.ts) decida donde persistirlo.
 */

export const DEFAULT_API_BASE_URL = 'http://localhost:8000';

export class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export interface User {
    id: string;
    name: string;
    email: string;
    role: 'student' | 'professor' | 'admin';
}

export interface Study {
    id: string;
    name: string;
    status: 'pending' | 'processing' | 'ready' | 'failed';
    created_by: string;
    created_at: string;
    stage: string | null;
    progress_percent: number | null;
    error_message: string | null;
}

export interface SessionInfo {
    id: string;
    user_id: string;
    study_id: string;
    started_at: string;
    ended_at: string | null;
}

export interface InteractionResponse {
    id: string;
    session_id: string;
    action_type: string;
    occurred_at: string;
    metadata: Record<string, unknown>;
}

export interface ConsentStatus {
    accepted: boolean;
    accepted_at: string | null;
}

export interface SusResponseItem {
    question_number: number;
    score: number;
}

export interface SusQuestionnaire {
    id: string;
    user_id: string;
    session_id: string | null;
    completed_at: string;
    score: number;
    responses: SusResponseItem[];
}

async function request<T>(
    baseUrl: string,
    path: string,
    options: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
        let detail = response.statusText;
        try {
            const body = await response.json();
            detail = body.detail ?? detail;
        } catch {
            // el cuerpo no era JSON (ej. 401 sin token) -- se usa statusText
        }
        throw new ApiError(response.status, typeof detail === 'string' ? detail : JSON.stringify(detail));
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
}

export class AxialApiClient {
    private readonly baseUrl: string;

    constructor(baseUrl: string = DEFAULT_API_BASE_URL) {
        this.baseUrl = baseUrl;
    }

    async register(name: string, email: string, password: string): Promise<User> {
        return request<User>(this.baseUrl, '/auth/registro', {
            method: 'POST',
            body: { name, email, password },
        });
    }

    async login(email: string, password: string): Promise<{ access_token: string }> {
        return request<{ access_token: string }>(this.baseUrl, '/auth/login', {
            method: 'POST',
            body: { email, password },
        });
    }

    async me(token: string): Promise<User> {
        return request<User>(this.baseUrl, '/auth/me', { token });
    }

    async listStudies(token: string): Promise<Study[]> {
        return request<Study[]>(this.baseUrl, '/estudios', { token });
    }

    async getStudy(token: string, studyId: string): Promise<Study> {
        return request<Study>(this.baseUrl, `/estudios/${studyId}`, { token });
    }

    async createStudy(token: string, name: string): Promise<Study> {
        return request<Study>(this.baseUrl, '/estudios', { method: 'POST', token, body: { name } });
    }

    /** Sube un slice DICOM (un archivo = una llamada, seccion 6.2 del
     * documento de clean architecture) -- multipart, campo "file". */
    async uploadStudyFile(
        token: string,
        studyId: string,
        filename: string,
        file: File | Blob,
    ): Promise<void> {
        const formData = new FormData();
        formData.append('file', file, filename);
        const response = await fetch(
            `${this.baseUrl}/estudios/${studyId}/archivos/${encodeURIComponent(filename)}`,
            { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: formData },
        );
        if (!response.ok) {
            throw new ApiError(response.status, `no se pudo subir ${filename} (${response.status})`);
        }
    }

    async confirmStudyUpload(token: string, studyId: string, filenames: string[]): Promise<Study> {
        return request<Study>(this.baseUrl, `/estudios/${studyId}/confirmar-subida`, {
            method: 'POST',
            token,
            body: { filenames },
        });
    }

    /** Camino alternativo para un volumen .raw (sin cabecera) -- el archivo
     * no trae dims/dtype/spacing, asi que se declaran aca explicitamente
     * (a diferencia de un DICOM real). dims/spacing en orden (z, y, x).
     * valueRange es opcional -- si el cliente sabe que sus valores son HU
     * real (u otra escala fisica conocida), declara la ventana a mostrar;
     * sin el, el worker usa min-max automatico sobre los propios datos. */
    async confirmRawVolumeUpload(
        token: string,
        studyId: string,
        filename: string,
        dims: [number, number, number],
        dtype: string,
        spacing: [number, number, number],
        valueRange?: [number, number],
    ): Promise<Study> {
        return request<Study>(this.baseUrl, `/estudios/${studyId}/confirmar-subida-raw`, {
            method: 'POST',
            token,
            body: { filename, dims, dtype, spacing, value_range: valueRange ?? null },
        });
    }

    /** Descarga el volumen real (NIfTI comprimido) -- proxy de streaming de
     * la API hacia MinIO, nunca expuesto directo (seccion 6.6). */
    async getStudyVolume(
        token: string,
        studyId: string,
        detailLevel: 'preview' | 'full' = 'full',
    ): Promise<ArrayBuffer> {
        const response = await fetch(
            `${this.baseUrl}/estudios/${studyId}/volumen?detail_level=${detailLevel}`,
            { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok) {
            throw new ApiError(response.status, `no se pudo descargar el volumen (${response.status})`);
        }
        return response.arrayBuffer();
    }

    async startSession(token: string, studyId: string): Promise<SessionInfo> {
        return request<SessionInfo>(this.baseUrl, `/estudios/${studyId}/sesiones`, {
            method: 'POST',
            token,
        });
    }

    /** El endpoint devuelve 204 sin cuerpo (ver sessions.py) -- no hay
     * SessionInfo actualizado que devolver, solo confirma que se cerro. */
    async endSession(token: string, sessionId: string): Promise<void> {
        await request<void>(this.baseUrl, `/sesiones/${sessionId}/fin`, {
            method: 'POST',
            token,
        });
    }

    async recordInteraction(
        token: string,
        sessionId: string,
        actionType: string,
        metadata: Record<string, unknown> = {},
    ): Promise<InteractionResponse> {
        return request<InteractionResponse>(this.baseUrl, `/sesiones/${sessionId}/interacciones`, {
            method: 'POST',
            token,
            body: { action_type: actionType, metadata },
        });
    }

    async getConsentStatus(token: string): Promise<ConsentStatus> {
        return request<ConsentStatus>(this.baseUrl, '/consentimiento', { token });
    }

    async acceptConsent(token: string): Promise<ConsentStatus> {
        return request<ConsentStatus>(this.baseUrl, '/consentimiento', { method: 'POST', token });
    }

    async submitSus(
        token: string,
        responses: SusResponseItem[],
        sessionId?: string,
    ): Promise<SusQuestionnaire> {
        return request<SusQuestionnaire>(this.baseUrl, '/cuestionarios-sus', {
            method: 'POST',
            token,
            body: { session_id: sessionId ?? null, responses },
        });
    }

    async getSus(token: string, questionnaireId: string): Promise<SusQuestionnaire> {
        return request<SusQuestionnaire>(this.baseUrl, `/cuestionarios-sus/${questionnaireId}`, {
            token,
        });
    }
}
