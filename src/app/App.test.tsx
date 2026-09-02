import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { App } from './App'
import { AuthProvider } from '../features/auth/AuthProvider'

test('shows the activity center and responsive shell navigation', async () => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/activities']}>
        <AuthProvider><App /></AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(await screen.findByRole('link', { name: '羽點通首頁' })).toBeInTheDocument()
  expect(screen.getByText('羽點通')).toBeInTheDocument()
  expect(await screen.findAllByText('週日早場零打')).not.toHaveLength(0)
  expect(screen.getByText('小羽')).toBeInTheDocument()
  expect(screen.getByText('badminton_owner')).toBeInTheDocument()
  expect(screen.getByText('3 / 5')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^建立活動$/ })).toBeEnabled()
  expect(screen.getAllByLabelText('更多活動操作')).not.toHaveLength(0)

  fireEvent.click(screen.getByRole('tab', { name: /已封存 1/ }))
  expect(screen.getByText('八月零打')).toBeInTheDocument()
  expect(container.querySelector('.club-activity-list')).not.toHaveTextContent('週日早場零打')

  fireEvent.click(screen.getByRole('button', { name: '收合選單' }))
  expect(screen.getByRole('button', { name: '展開選單' })).toBeInTheDocument()

  expect(container.querySelector('.club-identity')).toHaveAttribute('href', '/activities')
  const clubHome = screen.getByRole('link', { name: /球團首頁/ })
  const clubSettings = screen.getByRole('link', { name: /球團設定/ })
  const createActivity = screen.getByRole('link', { name: /建立活動/ })
  expect(clubHome.compareDocumentPosition(clubSettings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(clubSettings.compareDocumentPosition(createActivity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

  const mobileHeader = container.querySelector('.mobile-shell-bar')
  expect(mobileHeader?.querySelector('.sidebar-logo')).toBeNull()
  expect(mobileHeader?.querySelector('[aria-label="帳號選單"]')).toBeNull()
})
