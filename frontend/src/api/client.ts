import axios, { type AxiosRequestConfig } from 'axios';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const http = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isCancel(error)) return Promise.reject(error);
    if (axios.isAxiosError<{ message?: string | string[] }>(error)) {
      const detail = error.response?.data?.message;
      const message = Array.isArray(detail)
        ? detail.join(' ')
        : typeof detail === 'string'
          ? detail
          : error.code === 'ECONNABORTED'
            ? 'A solicitação demorou mais que o esperado. Tente novamente.'
            : 'Não foi possível conectar ao servidor.';
      return Promise.reject(new ApiError(message, error.response?.status ?? 0));
    }
    return Promise.reject(error);
  },
);

export async function api<T>(path: string, config: AxiosRequestConfig = {}): Promise<T> {
  const response = await http.request<T>({ ...config, url: path });
  return response.status === 204 ? (undefined as T) : response.data;
}
